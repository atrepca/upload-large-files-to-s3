'use strict';

import pkg from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const {
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand
} = pkg;

const s3 = new S3Client({ region: process.env.AWS_REGION || "eu-central-1" });
const BUCKET_NAME = process.env.UploadBucket;

export const handler = async (event) => {
    console.log("Event received:", JSON.stringify(event, null, 2));

    // Handle CORS Preflight Requests
    if (event.requestContext.http.method === "OPTIONS") {
        console.log("Handling CORS preflight request");
        return {
            statusCode: 200,
            headers: corsHeaders(),
            body: ""
        };
    }

    try {
        console.log("Parsing request body...");
        const body = JSON.parse(event.body || '{}');
        console.log("Parsed body:", body);

        // Get path from URL
        const path = event.requestContext.http.path;

        // Handle different endpoints based on path
        if (path.endsWith('/initiate')) {
            return await handleInitiateMultipart(body);
        } else if (path.endsWith('/presign-part')) {
            return await handlePresignPart(body);
        } else if (path.endsWith('/complete')) {
            return await handleCompleteMultipart(body);
        } else if (path.endsWith('/abort')) {
            return await handleAbortMultipart(body);
        } else {
            return response(404, { message: 'Endpoint not found' });
        }
    } catch (error) {
        console.error("Error:", error);
        return response(500, { message: 'An error occurred', error: error.message });
    }
};

// Handle multipart upload initiation
async function handleInitiateMultipart(body) {
    const { filename, contentType } = body;
    if (!filename || !contentType) {
        console.warn("Missing filename or contentType in request");
        return response(400, { message: "Missing filename or contentType" });
    }

    // Generate a unique key for the file
    const key = `uploads/${new Date().toISOString()}-${filename}`;
    console.log(`Multipart upload key generated: ${key}`);

    const command = new CreateMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: contentType
    });

    try {
        const { UploadId } = await s3.send(command);
        console.log(`Multipart upload initiated with ID: ${UploadId}`);

        return response(200, {
            uploadId: UploadId,
            key: key
        });
    } catch (error) {
        console.error("Error initiating multipart upload:", error);
        throw error;
    }
}

// Handle presigning URLs for individual parts
async function handlePresignPart(body) {
    const { uploadId, key, partNumber } = body;

    if (!uploadId || !key || !partNumber) {
        console.warn("Missing required parameters in request");
        return response(400, { message: "Missing uploadId, key, or partNumber" });
    }

    const command = new UploadPartCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber
    });

    try {
        const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
        console.log(`Presigned URL generated for part ${partNumber}`);

        return response(200, {
            presignedUrl: presignedUrl
        });
    } catch (error) {
        console.error(`Error generating presigned URL for part ${partNumber}:`, error);
        throw error;
    }
}

// Handle completing multipart upload
async function handleCompleteMultipart(body) {
    const { uploadId, key, parts } = body;

    if (!uploadId || !key || !parts) {
        console.warn("Missing required parameters in request");
        return response(400, { message: "Missing uploadId, key, or parts" });
    }

    // Format the parts array for the S3 API
    const multipartParts = parts.map(part => ({
        ETag: part.ETag,
        PartNumber: part.PartNumber
    }));

    const command = new CompleteMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
            Parts: multipartParts
        }
    });

    try {
        const result = await s3.send(command);
        console.log("Multipart upload completed successfully");

        const fileUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'eu-central-1'}.amazonaws.com/${key}`;

        // Extract filename from the key
        const filename = key.split('/').pop();

        return response(200, {
            fileUrl: fileUrl,
            emailSent: true
        });
    } catch (error) {
        console.error("Error completing multipart upload:", error);
        throw error;
    }
}

// Handle aborting multipart upload
async function handleAbortMultipart(body) {
    const { uploadId, key } = body;

    if (!uploadId || !key) {
        console.warn("Missing required parameters in request");
        return response(400, { message: "Missing uploadId or key" });
    }

    const command = new AbortMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        UploadId: uploadId
    });

    try {
        await s3.send(command);
        console.log("Multipart upload aborted successfully");

        return response(200, {
            message: "Upload aborted successfully"
        });
    } catch (error) {
        console.error("Error aborting multipart upload:", error);
        throw error;
    }
}

// Standardized Response Function with Logging
function response(statusCode, body) {
    console.log(`Sending response (Status: ${statusCode})`, JSON.stringify(body, null, 2));
    return {
        statusCode,
        headers: corsHeaders(),
        body: JSON.stringify(body)
    };
}

// CORS Headers
function corsHeaders() {
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Credentials": "true"
    };
}

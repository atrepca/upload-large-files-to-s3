'use strict';

import pkg from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const { S3Client, PutObjectCommand } = pkg;
const s3 = new S3Client({ region: process.env.AWS_REGION || "eu-central-1" });
const BUCKET_NAME = process.env.UploadBucket;

export const handler = async (event) => {
    console.log("🔹 Received event:", JSON.stringify(event, null, 2));

    // Handle CORS Preflight Requests
    if (event.requestContext.http.method === "OPTIONS") {
        console.log("🔹 Handling CORS preflight request");
        return {
            statusCode: 200,
            headers: corsHeaders(),
            body: ""
        };
    }

    try {
        console.log("🔹 Parsing request body...");
        const body = JSON.parse(event.body || '{}');
        console.log("✅ Parsed body:", body);

        const { filename, contentType } = body;
        if (!filename || !contentType) {
            console.warn("⚠️ Missing filename or contentType in request");
            return response(400, { message: "Missing filename or contentType" });
        }

        // Generate a unique key for the file
        const key = `uploads/${new Date().toISOString()}-${filename}`;
        console.log(`🔹 Upload key generated: ${key}`);

        // Create presigned URL for S3 upload
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            ContentType: contentType
        });

        console.log("🔹 Requesting presigned URL...");
        const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
        console.log("✅ Presigned URL generated:", presignedUrl);

        return response(200, {
            uploadUrl: presignedUrl,
            fileUrl: `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
        });

    } catch (error) {
        console.error("❌ Error generating presigned URL:", error);
        return response(500, { message: 'Failed to generate presigned URL', error: error.message });
    }
};

// Standardized Response Function with Logging
function response(statusCode, body) {
    console.log(`🔹 Sending response (Status: ${statusCode})`, JSON.stringify(body, null, 2));
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

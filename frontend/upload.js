/**
 * S3 Multipart Upload Module
 * Handles large file uploads with concurrency limiting for better mobile/cellular performance
 */

// Global namespace for upload functionality
window.S3Upload = (function() {
    'use strict';

    // Constants
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunk size (minimum for S3 multipart upload)
    const DEFAULT_CONCURRENCY_LIMIT = 3; // Default number of simultaneous chunk uploads

    /**
     * Concurrency limiter utility for controlling simultaneous operations
     * @param {number} limit - Maximum number of concurrent operations
     */
    class ConcurrencyLimiter {
        constructor(limit = DEFAULT_CONCURRENCY_LIMIT) {
            this.limit = limit;
            this.running = 0;
            this.queue = [];
        }

        /**
         * Execute a function with concurrency limiting
         * @param {Function} fn - Function to execute
         * @returns {Promise} Promise that resolves when function completes
         */
        async execute(fn) {
            return new Promise((resolve, reject) => {
                this.queue.push({ fn, resolve, reject });
                this._tryNext();
            });
        }

        _tryNext() {
            if (this.running >= this.limit || this.queue.length === 0) {
                return;
            }

            this.running++;
            const { fn, resolve, reject } = this.queue.shift();

            fn()
                .then(resolve)
                .catch(reject)
                .finally(() => {
                    this.running--;
                    this._tryNext();
                });
        }
    }

    /**
     * S3 Upload Manager
     * Handles multipart uploads with progress tracking and concurrency control
     */
    class S3UploadManager {
        constructor(apiUrl, concurrencyLimit = DEFAULT_CONCURRENCY_LIMIT) {
            this.apiUrl = apiUrl;
            this.concurrencyLimiter = new ConcurrencyLimiter(concurrencyLimit);
            this.uploadId = '';
            this.uploadedParts = [];
            this.totalBytesUploaded = 0;
            this.lastPartBytesUploaded = 0;
        }

        /**
         * Upload a file using S3 multipart upload
         * @param {File} file - File to upload
         * @param {Object} callbacks - Progress and status callbacks
         * @returns {Promise<string>} Upload URL when complete
         */
        async uploadFile(file, callbacks = {}) {
            const {
                onProgress = () => {},
                onPartProgress = () => {},
                onError = () => {}
            } = callbacks;

            try {
                // Reset state
                this.uploadedParts = [];
                this.totalBytesUploaded = 0;
                this.lastPartBytesUploaded = 0;

                // Calculate total parts
                const totalParts = Math.ceil(file.size / CHUNK_SIZE);
                console.log(`Total file: ${file.size} bytes, Split into ${totalParts} parts`);

                // Initiate multipart upload
                console.log("Initiating multipart upload...");
                const initRes = await axios.post(`${this.apiUrl}/initiate`, {
                    filename: file.name,
                    contentType: file.type
                });

                if (!initRes.data.uploadId) {
                    throw new Error("Invalid response from server: missing uploadId");
                }

                this.uploadId = initRes.data.uploadId;
                const key = initRes.data.key;

                console.log(`Multipart upload initiated: ${this.uploadId}`);

                // Upload parts with concurrency limiting
                const uploadPromises = [];
                for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
                    const start = (partNumber - 1) * CHUNK_SIZE;
                    const end = Math.min(partNumber * CHUNK_SIZE, file.size);
                    const chunk = file.slice(start, end);

                    const uploadPromise = this.concurrencyLimiter.execute(() =>
                        this.uploadPart(chunk, partNumber, key, file, {
                            onProgress,
                            onPartProgress
                        })
                    );
                    uploadPromises.push(uploadPromise);
                }

                // Wait for all parts to upload
                await Promise.all(uploadPromises);
                console.log("All parts uploaded successfully");

                // Complete the multipart upload
                console.log("Completing multipart upload...");
                const completeRes = await axios.post(`${this.apiUrl}/complete`, {
                    uploadId: this.uploadId,
                    key: key,
                    parts: this.uploadedParts.sort((a, b) => a.PartNumber - b.PartNumber)
                });

                console.log("Multipart upload completed!");
                return completeRes.data.fileUrl;

            } catch (error) {
                console.error("Upload failed:", error);
                onError(error);

                // Try to abort the multipart upload if it was initiated
                if (this.uploadId) {
                    try {
                        await axios.post(`${this.apiUrl}/abort`, {
                            uploadId: this.uploadId,
                            key: key
                        });
                        console.log("Multipart upload aborted");
                    } catch (abortError) {
                        console.error("Error aborting upload:", abortError);
                    }
                }
                throw error;
            }
        }

        /**
         * Upload a single part of the file
         * @param {Blob} chunk - File chunk to upload
         * @param {number} partNumber - Part number
         * @param {string} key - S3 object key
         * @param {File} file - Original file (for progress calculation)
         * @param {Object} callbacks - Progress callbacks
         * @returns {Promise} Promise that resolves when part is uploaded
         */
        async uploadPart(chunk, partNumber, key, file, callbacks = {}) {
            const { onProgress = () => {}, onPartProgress = () => {} } = callbacks;

            try {
                onPartProgress(partNumber);

                // Get presigned URL for this part
                const presignRes = await axios.post(`${this.apiUrl}/presign-part`, {
                    uploadId: this.uploadId,
                    key: key,
                    partNumber: partNumber
                });

                const presignedUrl = presignRes.data.presignedUrl;

                // Upload the chunk directly to S3 using the presigned URL
                return new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();

                    xhr.upload.addEventListener('progress', (event) => {
                        if (event.lengthComputable) {
                            // Track bytes uploaded for this part
                            const bytesUploaded = Math.min(event.loaded, event.total);
                            this.totalBytesUploaded = Math.min(
                                file.size,
                                this.totalBytesUploaded + (bytesUploaded - (this.lastPartBytesUploaded || 0))
                            );
                            this.lastPartBytesUploaded = bytesUploaded;

                            const uploadProgress = Math.round((this.totalBytesUploaded / file.size) * 100);
                            onProgress(uploadProgress);
                        }
                    });

                    xhr.addEventListener('load', () => {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            const etag = xhr.getResponseHeader('ETag');
                            this.uploadedParts.push({
                                PartNumber: partNumber,
                                ETag: etag
                            });
                            this.lastPartBytesUploaded = 0;
                            this.totalBytesUploaded += chunk.size;
                            const uploadProgress = Math.round((this.totalBytesUploaded / file.size) * 100);
                            onProgress(uploadProgress);
                            resolve();
                        } else {
                            reject(new Error(`Upload failed for part ${partNumber}: ${xhr.statusText}`));
                        }
                    });

                    xhr.addEventListener('error', () => {
                        reject(new Error(`Network error uploading part ${partNumber}`));
                    });

                    xhr.open('PUT', presignedUrl);
                    xhr.send(chunk);
                });
            } catch (error) {
                console.error(`Error uploading part ${partNumber}:`, error);
                throw error;
            }
        }
    }

    /**
     * Initialize upload functionality
     * @param {string} apiUrl - API endpoint URL
     * @param {number} concurrencyLimit - Maximum concurrent uploads
     * @returns {S3UploadManager} Upload manager instance
     */
    function initializeUpload(apiUrl, concurrencyLimit = DEFAULT_CONCURRENCY_LIMIT) {
        return new S3UploadManager(apiUrl, concurrencyLimit);
    }

    // Public API
    return {
        initializeUpload: initializeUpload,
        S3UploadManager: S3UploadManager,
        ConcurrencyLimiter: ConcurrencyLimiter
    };
})();
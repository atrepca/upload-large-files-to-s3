# S3 Large File Uploader

Serverless app for uploading large files directly to S3 from a browser using multipart upload and presigned URLs. Raw file data never passes through Lambda.

## How it works

```
Browser → POST /initiate      → Lambda → S3 CreateMultipartUpload
Browser → POST /presign-part  → Lambda → returns presigned PUT URL per part
Browser → PUT <presigned URL> → S3 directly
Browser → POST /complete      → Lambda → S3 CompleteMultipartUpload
Browser → POST /abort         → Lambda → S3 AbortMultipartUpload (on failure)
```

Files are split into 5 MB parts and uploaded in parallel. Progress is tracked per-byte across all concurrent part uploads.

## Stack

| Resource | Type | Purpose |
|---|---|---|
| `S3UploadBucket` | `AWS::S3::Bucket` | Stores uploaded files; serves the static frontend |
| `UploadRequestFunction` | `AWS::Serverless::Function` | Multipart upload orchestration (Node.js 22.x) |
| `UploadRequestFunctionUrl` | `AWS::Lambda::Url` | Public HTTP endpoint, `AuthType: NONE` |
| `UploadLambdaExecutionRole` | `AWS::IAM::Role` | Scoped to S3 multipart upload actions only |

## Project structure

```
├── backend/
│   ├── app.js          # Lambda handler
│   └── package.json
├── frontend/
│   ├── index.html      # Vue.js SPA — uses __LAMBDA_URL__ placeholder
│   ├── style.css
│   └── lang/
│       ├── en.js
│       └── ro.js
├── Makefile            # deploy + sync targets
├── samconfig.toml      # SAM deploy config (not committed)
└── template.yaml       # SAM template
```

## Deployment

### Prerequisites

- AWS CLI configured
- AWS SAM CLI — `pipx install aws-sam-cli` or see [install docs](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)

### First-time setup

Run `sam deploy --guided` to generate `samconfig.toml`, then commit nothing — `samconfig.toml` stays local.

### Deploy infrastructure

```sh
make deploy
```

Runs `sam build` and `sam deploy`. Stack outputs the Lambda URL, website URL, and bucket name.

### Deploy frontend

```sh
make sync
```

Reads the Lambda URL from the CloudFormation stack outputs, injects it into `index.html` at upload time (the source file keeps the `__LAMBDA_URL__` placeholder and is never modified on disk), then syncs all frontend assets to S3.

The Lambda URL is never committed to the repository.

## Security notes

- **Lambda URL** has no authentication — consider AWS WAF to rate-limit or restrict access.
- **CORS** is open (`AllowedOrigins: ["*"]`) — restrict to your domain in `template.yaml` for production.
- **Uploaded files are publicly readable** — the bucket policy grants `s3:GetObject` to `*`, covering both the static site and uploaded objects. Use separate buckets or a scoped policy if that is not acceptable.
- Files are stored under `uploads/<ISO-timestamp>-<filename>`.

## Language

The UI defaults to Romanian. To switch to English, update line 11 of `frontend/index.html`:

```html
<script src="lang/en.js"></script>
```

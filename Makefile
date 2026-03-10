PROFILE ?= $(shell grep '^profile'    samconfig.toml | cut -d'"' -f2)
STACK   ?= $(shell grep '^stack_name' samconfig.toml | cut -d'"' -f2)
REGION  ?= $(shell grep '^region'     samconfig.toml | cut -d'"' -f2)

.PHONY: deploy sync

deploy:
	SAM_CLI_TELEMETRY=0 sam build && SAM_CLI_TELEMETRY=0 sam deploy --no-confirm-changeset

sync:
	@URL=$$(aws cloudformation describe-stacks --stack-name $(STACK) --region $(REGION) --profile $(PROFILE) \
	  --query 'Stacks[0].Outputs[?OutputKey==`FunctionUrl`].OutputValue' --output text | sed 's|/$$||') && \
	sed "s|__LAMBDA_URL__|$$URL|" frontend/index.html \
	  | aws s3 cp - s3://$(STACK)/index.html --content-type text/html --profile $(PROFILE) --region $(REGION) && \
	aws s3 sync frontend/ s3://$(STACK)/ --exclude index.html --profile $(PROFILE) --region $(REGION)

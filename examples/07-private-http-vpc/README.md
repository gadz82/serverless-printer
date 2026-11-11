# Private HTTP callback — standard PDF

- **Channel:** `http`
- **PDF:** standard PDF
- **Config:** [`config.tfvars.example`](config.tfvars.example)

## What it demonstrates

Runs the worker in a VPC and delivers to a private HTTPS host reachable from the private subnets. This is the configuration for internal APIs that are not publicly reachable.

## Configure

Append the snippet to `TF_VARS` (or a manual `infra/terraform.tfvars`) and deploy/re-apply the
stack. Replace every example host, ARN and account id with your own.

## Send

```sh
aws sqs send-message \
  --queue-url "$JOBS_QUEUE_URL" \
  --message-body file://examples/07-private-http-vpc/sqs-payload.json \
  --region "$AWS_REGION"
```

`JOBS_QUEUE_URL` and `AWS_REGION` come from the Terraform outputs and your deployment.

## SQS payload

[`sqs-payload.json`](sqs-payload.json) is the exact `MessageBody` sent to the jobs queue. The
`webhooks.success.channel` field selects the output channel; the `payload` object is the
Handlebars context. The command above sends this file with `aws sqs send-message`.

## Expected result

The private endpoint receives the same JSON result as a public HTTP callback, including the presigned `printing` URL. The worker reaches SQS/S3/Lambda/Events through VPC endpoints; the private callback target is reached through the VPC/peering.

## Notes

`create` mode creates the VPC and endpoints; `lookup` can attach to an existing VPC instead. If the callback is outside the VPC, set `enable_nat_gateway = true` or provide equivalent connectivity. DNS must resolve to an allowed private address; metadata/link-local targets remain blocked.

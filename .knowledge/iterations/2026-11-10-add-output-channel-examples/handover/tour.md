# Tour — output channel examples

1. `examples/README.md` — matrix, SQS MessageBody shape and send commands.
2. `examples/01-http-standard/sqs-payload.json` — base job with allowlisted HTTP callback.
3. `examples/02-http-pdfa/sqs-payload.json` — PDF/A-2b option.
4. `examples/03-lambda-callback/sqs-payload.json` — Lambda callback target.
5. `examples/04-sqs-fifo/sqs-payload.json` — FIFO callback queue.
6. `examples/05-eventbridge-callback/sqs-payload.json` — EventBridge bus callback.
7. `examples/06-s3-pdfa/sqs-payload.json` — presigned S3 PUT with HTTP failure.
8. `examples/07-private-http-vpc/sqs-payload.json` — private HTTP + VPC config.
9. `examples/08-eventbridge-ingress/event.json` and `sqs-payload.json` — ingress detail = job body.
10. `tests/examples/examples.test.ts` — contract, file and channel coverage checks.

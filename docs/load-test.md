# Load test and Power Tuning

The load test sends a deterministic mix of `generic-report` jobs to the deployed
jobs queue and reports throughput, latency, errors and Lambda memory. It is an
operator tool: it needs a deployed stack and AWS credentials, and it is not run
by CI.

## Candidate target

The candidate throughput target is **10 20-page jobs/min with 20-page p95 below
30 s**. Treat it as unconfirmed until the first load test and Power Tuning run
record the measured values; update this document and the release record when the
product owner confirms the target.

`LOAD_TEST_ENFORCE_TARGET=1` enforces the **20-page** throughput and p95 (not the
mixed aggregate). Twenty jobs only give ten 20-page samples, so use
`LOAD_TEST_JOBS=100` or more when collecting target evidence.

## Scenarios

`LOAD_TEST_JOBS` jobs (default 20, maximum 200) cycle through:

| Scenario        | Template payload           | `pdfA`     |
| --------------- | -------------------------- | ---------- |
| `1-page-plain`  | 3 line items               | `false`    |
| `1-page-pdfa`   | 3 line items               | `PDF/A-2b` |
| `20-page-plain` | 450 line items (~20 pages) | `false`    |
| `20-page-pdfa`  | 450 line items (~20 pages) | `PDF/A-2b` |

The 20-page payload is `generic-report` with 450 table rows; it renders about 20
pages locally and on the worker. The exact pagination can vary by one page with
font metrics, which does not change the load-test intent.

Each job uses a unique `refId`, a success and a failure SQS callback to the
same results queue, and the sample payload is synthetic.

## Prerequisites

- A deployed stack from `release.yml`.
- An operator identity with `sqs:SendMessage` on the jobs queue and
  `sqs:ReceiveMessage` and `sqs:DeleteMessage` on the callback queue.
- Optional: the AWS CLI and `logs:FilterLogEvents` on the worker log group for
  the `Max Memory Used` report.
- The load test injects work into the live jobs queue and consumes worker
  capacity. Run it off-peak and not during a release smoke test; both use the
  smoke results queue by default. Unique `refId`s prevent false matches, but
  extra messages make queue inspection noisy.

### Results queue retention

The shared `<name_prefix>-smoke-results` queue retains messages for five
minutes. The script's default timeout is 240 s to stay inside that window. For
longer runs, or more than about 40 jobs, create a dedicated results queue with
longer retention, add its ARN to `callback_target_arns`, and apply the stack so
the worker is allowed to send to it. Then set `CALLBACK_QUEUE_URL` and
`CALLBACK_QUEUE_ARN` to that queue. `LOAD_TEST_TIMEOUT_SECONDS` can be raised up
to 3,600 s only when the queue retention is longer than the timeout.

## Run

```sh
export AWS_REGION="eu-central-1"
export JOBS_QUEUE_URL="$(terraform -chdir=infra output -raw jobs_queue_url)"
export CALLBACK_QUEUE_URL="$(terraform -chdir=infra output -raw smoke_queue_url)"
export CALLBACK_QUEUE_ARN="$(terraform -chdir=infra output -raw smoke_queue_arn)"
export WORKER_LOG_GROUP="/aws/lambda/$(terraform -chdir=infra output -raw function_name)"
export LOAD_TEST_JOBS=20
export LOAD_TEST_TIMEOUT_SECONDS=240

node scripts/load-test.mjs
```

The script prints:

- completed/sent/total jobs and the scenario mix;
- mixed throughput in jobs/min;
- **20-page** throughput, p95 and sample count;
- p50, p95 and maximum end-to-end latency in milliseconds (send to callback
  receive);
- p50, p95 and maximum `Max Memory Used` in MB when `WORKER_LOG_GROUP` is set;
- the number of invalid or unsuccessful results plus any SQS send failures,
  with error codes.

Exit code is non-zero when any job fails, a result is invalid, a send fails, a
result is missing, or the wait times out. Add
`LOAD_TEST_ENFORCE_TARGET=1` to also fail when 20-page throughput is below
10 jobs/min, 20-page p95 is at least 30 s, or there are errors. Leave it unset
until the target is confirmed.

`LOAD_TEST_JOBS` is capped at 200 to bound cost. The default 240 s timeout suits
the shared five-minute results queue; a 200-job run at the candidate rate needs
a longer dedicated queue and timeout.

## Power Tuning

Use AWS Lambda Power Tuning in the same region as the deployed stack. Power
Tuning invokes the worker directly, so it does not consume jobs from SQS. The
worker still renders and sends its configured callback.

1. Deploy the AWS Lambda Power Tuning state machine from the AWS Serverless
   Application Repository (SAR) in the same region, or use an existing
   installation.

2. Print an SQS event for each of the four scenarios:

   ```sh
   export CALLBACK_QUEUE_ARN="$(terraform -chdir=infra output -raw smoke_queue_arn)"
   node scripts/load-test.mjs --print-event 1-page-plain > /tmp/pt-1-plain.json
   node scripts/load-test.mjs --print-event 1-page-pdfa > /tmp/pt-1-pdfa.json
   node scripts/load-test.mjs --print-event 20-page-plain > /tmp/pt-20-plain.json
   node scripts/load-test.mjs --print-event 20-page-pdfa > /tmp/pt-20-pdfa.json
   ```

   `CALLBACK_QUEUE_ARN` is required. The event uses
   `ApproximateReceiveCount = MAX_RECEIVE_COUNT` (default 5) so a retryable
   failure is treated as the last attempt and its failure callback is delivered
   instead of being silently retried. Set `MAX_RECEIVE_COUNT` if the deployed
   `max_receive_count` is not 5. Use the smoke queue, or add a dedicated ARN to
   `callback_target_arns`; every invocation sends a result there.

3. Start the state machine with one payload and a memory range around the
   1,536 MB default. Example input:

   ```json
   {
     "lambdaARN": "arn:aws:lambda:eu-central-1:123456789012:function:printer-render-worker",
     "powerValues": [1024, 1536, 2048, 3008],
     "num": 20,
     "payload": {},
     "parallelInvocation": false,
     "strategy": "cost"
   }
   ```

   Replace `payload` with the contents of one printed event (for example
   `/tmp/pt-20-pdfa.json`) and `lambdaARN` with the **unqualified** worker
   function ARN. Power Tuning's initializer rejects an alias ARN (it expects
   exactly seven ARN segments):

   ```sh
   export POWER_TUNING_LAMBDA_ARN="$(aws lambda get-function \
     --function-name "$(terraform -chdir=infra output -raw function_name)" \
     --query Configuration.FunctionArn --output text)"
   ```

   Power Tuning changes the unqualified function (`$LATEST`) configuration.
   Publish a new version and point the `live` alias at it through the normal
   Terraform apply after choosing the memory value. Start the execution:

   ```sh
   aws stepfunctions start-execution \
     --state-machine-arn "<power-tuning-state-machine-arn>" \
     --input "file:///tmp/power-tuning-input.json"
   ```

   Repeat for the four scenarios. `num: 20` gives a reasonable average without
   excessive cost; raise it for tighter results. The SAR stack creates an
   execution role with Lambda configuration/alias/invoke permissions and basic
   execution logging. Confirm that role can invoke and update the target
   function; if you use a custom role, grant `lambda:InvokeFunction`,
   `lambda:GetFunctionConfiguration` and `lambda:UpdateFunctionConfiguration`
   on the worker, plus the logging permissions the state machine needs.

4. Compare **average duration and cost** per memory. Power Tuning's standard
   output reports averages, not p95. Use the load test (or CloudWatch
   `Duration`) for p95 at the candidate memory settings; the two numbers are not
   directly comparable because the load test measures end-to-end queue latency
   and Power Tuning measures invocation duration.

5. Apply the measured values through the release path. The release workflow
   materializes `infra/terraform.tfvars` from the GitHub repository variable
   `TF_VARS`, so editing a local tfvars file is not enough for the next
   deployment. Update `TF_VARS` in the repository settings (or run a manual
   `terraform -chdir=infra apply` with the same backend and vars) with:

   ```hcl
   worker_memory_size  = 1536 # measured value
   maximum_concurrency = 10   # starting/default value; adjust from observed concurrency
   batch_size          = 5
   # reserved_concurrency = 5
   ```

   `worker_memory_size` is a root and module variable validated between 128 and
   10,240 MB; `maximum_concurrency` is the SQS event-source concurrency and
   `reserved_concurrency` caps the function. Lower `batch_size` if a batch of
   five 20-page PDF/A jobs makes p95 too high. If you change the concurrency
   target, measure `ConcurrentExecutions` in CloudWatch; the load test does not
   measure it directly.

6. Re-run `release.yml` (after updating `TF_VARS`) and the load test with
   `LOAD_TEST_ENFORCE_TARGET=1` once the target is confirmed.

Record the function version/release, memory settings, job mix, measured
throughput/p95/memory and the chosen values in the release/change record.

## Limitations

- Latency is measured from SQS send to callback receive; it includes queueing,
  cold starts and worker retries, which is the user-visible latency for this
  asynchronous product.
- Memory comes from the Lambda `REPORT` lines; it is not a per-job metric when
  a batch processes several jobs.
- The load test does not assert PDF page counts or PDF/A conformance; the render
  regression and archiver tests cover those.
- On a send failure the script reports the affected jobs but cannot retract
  messages that SQS already accepted; inspect the queue if a batch call fails
  after partial acceptance.

import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  CallbackChannel,
  CallbackTargetValidator,
  Clock,
  IdGenerator,
  PdfDestination,
  PdfRenderer,
  PrintRepository,
  PrintResult,
  ResultDelivery,
} from "@printer/domain";
import { ProcessPrintJob, type ProcessPrintJobInput } from "@printer/domain";
import { ManifestTemplateCatalog } from "./adapters/manifest-template-catalog.js";
import { S3PrintRepository } from "./adapters/s3-print-repository.js";
import { SqsResultDelivery } from "./adapters/sqs-result-delivery.js";
import type { SqsSendClient } from "./adapters/sqs-result-delivery.js";
import { UuidPrintIdGenerator } from "./adapters/uuid-print-id-generator.js";
import { loadConfig, type WorkerConfig } from "./config.js";
import { CallbackPing } from "./delivery/callback-ping.js";
import { EventBridgeResultDelivery } from "./delivery/eventbridge-result-delivery.js";
import type { EventBridgePutEventsClient } from "./delivery/eventbridge-result-delivery.js";
import { HttpResultDelivery } from "./delivery/http-result-delivery.js";
import { pinnedHttpRequest } from "./delivery/http-request.js";
import type { PinnedHttpRequest } from "./delivery/http-request.js";
import { LambdaResultDelivery } from "./delivery/lambda-result-delivery.js";
import type { LambdaInvokeClient } from "./delivery/lambda-result-delivery.js";
import { PingingResultDelivery } from "./delivery/pinging-result-delivery.js";
import { ResultDeliveryRouter } from "./delivery/result-delivery-router.js";
import { S3PdfDestination } from "./delivery/s3-pdf-destination.js";
import { JsonLogger, type WorkerLogger } from "./logger.js";
import { PdfLibPdfArchiver } from "./pdfa/pdf-lib-pdf-archiver.js";
import { ChromiumPdfRenderer } from "./rendering/chromium-pdf-renderer.js";
import { LocalChromeRenderer } from "./rendering/local-chrome-renderer.js";
import { TemplatePdfRenderer } from "./rendering/template-pdf-renderer.js";
import { CallbackPolicy } from "./security/index.js";

const SUPPORTED_CHANNELS: readonly CallbackChannel[] = [
  "http",
  "lambda",
  "sqs",
  "eventBridge",
  "s3",
];

export type PrintJobExecutor = {
  execute(input: ProcessPrintJobInput): Promise<PrintResult>;
};

export type WorkerRuntime = {
  readonly config: WorkerConfig;
  readonly processPrintJob: PrintJobExecutor;
  readonly pdfRenderer: PdfRenderer;
  readonly pdfDestination: PdfDestination;
  readonly resultDelivery: ResultDelivery;
  readonly callbackValidator: CallbackTargetValidator;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: WorkerLogger;
};

export type WorkerOverrides = {
  readonly pdfRenderer?: PdfRenderer;
  readonly printRepository?: PrintRepository;
  readonly sqsClient?: SqsSendClient;
  readonly lambdaClient?: LambdaInvokeClient;
  readonly eventBridgeClient?: EventBridgePutEventsClient;
  readonly httpRequest?: PinnedHttpRequest;
  readonly s3Request?: PinnedHttpRequest;
  readonly callbackPolicy?: CallbackPolicy;
};

/**
 * The only wiring point. It runs once per cold start and returns the complete
 * runtime; no adapter reaches for a global client. The renderer, AWS clients
 * and HTTP seams are overrides for integration tests, not production choices.
 */
// ORCHID-MEM: 01a1c1d8-f229-78d0-8db6-dcbfec06856f — Single composition root wiring config, manifest, AWS clients, adapters and the print use case.
export function composeWorker(
  env: NodeJS.ProcessEnv = process.env,
  overrides: WorkerOverrides = {},
): WorkerRuntime {
  const config = loadConfig(env);
  const logger = new JsonLogger();

  const manifestPath = config.templateManifestPath;
  const templateCatalog = new ManifestTemplateCatalog(manifestPath);
  const s3Client = new S3Client({});
  const sqsClientConfig =
    config.sqsEndpointUrl === undefined ? {} : { endpoint: config.sqsEndpointUrl };
  const sqsAwsClient = new SQSClient(sqsClientConfig);
  const lambdaAwsClient = new LambdaClient({});
  const eventBridgeAwsClient = new EventBridgeClient({});

  const printRepository =
    overrides.printRepository ??
    new S3PrintRepository({
      client: { send: (command) => s3Client.send(command) },
      bucket: config.printsBucket,
      presignTtlSeconds: config.presignTtlSeconds,
      presign: ({ bucket, key, expiresIn }) =>
        getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn }),
    });

  const callbackPolicy =
    overrides.callbackPolicy ?? new CallbackPolicy({ allowlist: config.callbackAllowlist });
  const httpRequest = overrides.httpRequest ?? pinnedHttpRequest;
  const pings = new CallbackPing({ policy: callbackPolicy, request: httpRequest, logger });

  const defaultSqsClient: SqsSendClient = {
    send: (command: SendMessageCommand) => sqsAwsClient.send(command),
  };
  const resultDelivery = new PingingResultDelivery(
    new ResultDeliveryRouter({
      http: new HttpResultDelivery({ policy: callbackPolicy, request: httpRequest }),
      lambda: new LambdaResultDelivery(
        overrides.lambdaClient ?? {
          send: (command) => lambdaAwsClient.send(command),
        },
      ),
      sqs: new SqsResultDelivery(overrides.sqsClient ?? defaultSqsClient, config.sqsEndpointUrl),
      eventBridge: new EventBridgeResultDelivery(
        overrides.eventBridgeClient ?? {
          send: (command) => eventBridgeAwsClient.send(command),
        },
        config.eventSource,
      ),
    }),
    pings,
  );

  const pdfDestination = new S3PdfDestination({
    pings,
    request: overrides.s3Request ?? httpRequest,
    allowPrivateEndpoint: config.allowPrivateS3Endpoint,
  });
  const pdfRenderer =
    overrides.pdfRenderer ??
    new TemplatePdfRenderer({
      manifestPath,
      mode: config.handlebarsMode,
      chromium: selectChromiumRenderer(env, config.pdfRendererMode),
    });

  const clock: Clock = { now: () => new Date() };
  const idGenerator = new UuidPrintIdGenerator();

  const processPrintJob = new ProcessPrintJob({
    templateCatalog,
    pdfRenderer,
    pdfArchiver: new PdfLibPdfArchiver(),
    printRepository,
    pdfDestination,
    resultDelivery,
    callbackValidator: callbackPolicy,
    clock,
    idGenerator,
    logger,
    supportedChannels: SUPPORTED_CHANNELS,
    pdfaAllowedLevels: config.pdfaAllowedLevels,
  });

  return {
    config,
    processPrintJob,
    pdfRenderer,
    pdfDestination,
    resultDelivery,
    callbackValidator: callbackPolicy,
    idGenerator,
    clock,
    logger,
  };
}

function selectChromiumRenderer(
  env: NodeJS.ProcessEnv,
  mode: WorkerConfig["pdfRendererMode"],
): ChromiumPdfRenderer | LocalChromeRenderer {
  if (mode === "local") {
    return new LocalChromeRenderer();
  }
  if (mode === "lambda") {
    return new ChromiumPdfRenderer();
  }

  const lambdaFunctionName = env["AWS_LAMBDA_FUNCTION_NAME"]?.trim();
  return lambdaFunctionName === undefined || lambdaFunctionName.length === 0
    ? new LocalChromeRenderer()
    : new ChromiumPdfRenderer();
}

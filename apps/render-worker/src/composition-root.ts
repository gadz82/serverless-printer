import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  CallbackChannel,
  Clock,
  IdGenerator,
  PdfaLevel,
  PdfRenderer,
  PrintResult,
  ResultDelivery,
} from "@printer/domain";
import { ProcessPrintJob, type ProcessPrintJobInput } from "@printer/domain";
import { ManifestTemplateCatalog } from "./adapters/manifest-template-catalog.js";
import { PlaceholderPdfRenderer } from "./adapters/placeholder-pdf-renderer.js";
import { S3PrintRepository } from "./adapters/s3-print-repository.js";
import { SqsResultDelivery } from "./adapters/sqs-result-delivery.js";
import type { SqsSendClient } from "./adapters/sqs-result-delivery.js";
import { UuidPrintIdGenerator } from "./adapters/uuid-print-id-generator.js";
import { loadConfig, type WorkerConfig } from "./config.js";
import { JsonLogger, type WorkerLogger } from "./logger.js";
import { PdfLibPdfArchiver } from "./pdfa/pdf-lib-pdf-archiver.js";

const SUPPORTED_CHANNELS: readonly CallbackChannel[] = ["sqs"];

/**
 * P-202 wires the archiver but leaves the Phase 1 allowlist empty until P-204
 * replaces the placeholder renderer and passes the configured levels.
 */
const PHASE_ONE_PDFA_LEVELS: readonly PdfaLevel[] = [];

export type PrintJobExecutor = {
  execute(input: ProcessPrintJobInput): Promise<PrintResult>;
};

export type WorkerRuntime = {
  readonly config: WorkerConfig;
  readonly processPrintJob: PrintJobExecutor;
  readonly resultDelivery: ResultDelivery;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: WorkerLogger;
};

export type WorkerOverrides = {
  readonly pdfRenderer?: PdfRenderer;
  readonly sqsClient?: SqsSendClient;
};

/**
 * The only wiring point. It runs once per cold start and returns the complete
 * runtime; no adapter reaches for a global client. The renderer and SQS client
 * overrides are test seams for integration failures, not production choices.
 */
// ORCHID-MEM: 01a1c1d8-f229-78d0-8db6-dcbfec06856f — Single composition root wiring config, manifest, AWS clients, adapters and the print use case.
export function composeWorker(
  env: NodeJS.ProcessEnv = process.env,
  overrides: WorkerOverrides = {},
): WorkerRuntime {
  const config = loadConfig(env);
  const logger = new JsonLogger();

  if (config.pdfaAllowedLevels.length > 0) {
    logger.warn("pdfa_levels_ignored");
  }

  const manifestPath = config.templateManifestPath;
  const templateCatalog = new ManifestTemplateCatalog(manifestPath);
  const s3Client = new S3Client({});
  const sqsClientConfig =
    config.sqsEndpointUrl === undefined ? {} : { endpoint: config.sqsEndpointUrl };
  const sqsAwsClient = new SQSClient(sqsClientConfig);

  const printRepository = new S3PrintRepository({
    client: { send: (command) => s3Client.send(command) },
    bucket: config.printsBucket,
    presignTtlSeconds: config.presignTtlSeconds,
    presign: ({ bucket, key, expiresIn }) =>
      getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn }),
  });

  const defaultSqsClient: SqsSendClient = {
    send: (command: SendMessageCommand) => sqsAwsClient.send(command),
  };
  const resultDelivery = new SqsResultDelivery(
    overrides.sqsClient ?? defaultSqsClient,
    config.sqsEndpointUrl,
  );
  const clock: Clock = { now: () => new Date() };
  const idGenerator = new UuidPrintIdGenerator();

  const processPrintJob = new ProcessPrintJob({
    templateCatalog,
    pdfRenderer: overrides.pdfRenderer ?? new PlaceholderPdfRenderer(),
    pdfArchiver: new PdfLibPdfArchiver(),
    printRepository,
    resultDelivery,
    clock,
    idGenerator,
    logger,
    supportedChannels: SUPPORTED_CHANNELS,
    pdfaAllowedLevels: PHASE_ONE_PDFA_LEVELS,
  });

  return {
    config,
    processPrintJob,
    resultDelivery,
    idGenerator,
    clock,
    logger,
  };
}

# Data impact

No persistent data, schema, migration or retention change. EventBridge events become normal SQS
messages and follow the existing queue retention/DLQ and transient S3 print lifecycle.

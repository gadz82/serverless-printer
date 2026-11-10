# Estimate

- Size: S
- Effort: one build prompt, 1–2 hours including plans and review.
- Risk: low; opt-in Terraform only, no data or runtime contract change.
- Confidence: high for static validation; medium for first live apply due to the EventBridge/SQS
  queue-policy interaction.

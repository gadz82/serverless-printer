/**
 * Caller reference echoed unchanged in both success and failure results.
 *
 * The public contract has already rejected arrays, booleans and null before a
 * PrintJob reaches the domain; this type intentionally mirrors only the three
 * shapes the contract allows.
 */
export type RefId = string | number | Record<string, unknown>;

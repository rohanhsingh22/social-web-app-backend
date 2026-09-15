// Shared BullMQ queue/job names. Queues are registered per app:
// feature modules register their queue for producing (API), worker modules
// register the same queue for consuming (worker). Realtime needs none.

export const NOTIFICATIONS_QUEUE = 'notifications';
export const THOUGHT_EVENTS_QUEUE = 'thought-events';
export const SESSION_CLEANUP_QUEUE = 'session-cleanup';

export const NOTIFICATION_CREATE_JOB = 'NOTIFICATION_CREATE';
export const THOUGHT_EVENT_PROCESS_JOB = 'THOUGHT_EVENT_PROCESS';
export const SESSION_CLEANUP_JOB = 'SESSION_CLEANUP';

// Session cleanup cadence and retention.
export const SESSION_CLEANUP_EVERY_MS = 6 * 60 * 60 * 1000;
export const REVOKED_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

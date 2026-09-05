export type ApiEnvelope<T> = {
  data: T;
};

export const envelope = <T>(data: T): ApiEnvelope<T> => ({ data });

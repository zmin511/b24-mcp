export type BitrixRestResponse<T> = {
  result?: T;
  error?: string;
  error_description?: string;
  time?: unknown;
  total?: number;
  next?: number;
};

export type BitrixRestError = {
  error: string;
  error_description?: string;
};


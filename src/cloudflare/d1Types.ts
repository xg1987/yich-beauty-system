export type D1Value = string | number | null;

export type D1Result<T = Record<string, unknown>> = {
  results?: T[];
  success: boolean;
};

export type D1PreparedStatement = {
  bind(...values: D1Value[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
};

export type D1DatabaseBinding = {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
};

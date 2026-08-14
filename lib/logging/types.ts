export type QueryLogStatus = 'success' | 'error';

export interface QueryLogRow {
  id: string;
  created_at: string;
  session_id: string;
  question: string;
  answer: string | null;
  chart_summary: string;
  status: QueryLogStatus;
  error_message: string | null;
  duration_ms: number;
  country: string | null;
}

export interface QueryLogListResponse {
  logs: QueryLogRow[];
  total: number;
  page: number;
  pageSize: number;
}

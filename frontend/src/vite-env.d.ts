/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the backend, e.g. https://yt-clip-api.onrender.com (no trailing slash). */
  readonly VITE_API_BASE_URL?: string;
  /** Byte threshold above which the large-download note is shown. Default 500 MB. */
  readonly VITE_LARGE_DOWNLOAD_BYTES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

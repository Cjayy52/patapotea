import { HttpApi } from './http.js';
import { LocalApi } from './local.js';

let api;

/** Single adapter instance: real server or offline preview build. */
export function getApi() {
  if (!api) {
    api = typeof __PREVIEW_MODE__ !== 'undefined' && __PREVIEW_MODE__ ? new LocalApi() : new HttpApi();
  }
  return api;
}

export { ApiError } from './http.js';

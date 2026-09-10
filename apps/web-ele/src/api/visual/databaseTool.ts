import { adminUrl } from '#/config';
import request from '#/utils/request';

const toolUrl = adminUrl + '/databaseTool/';

export interface DatabaseToolCatalogVO {
  dbType: string;
  dbLabel: string;
  toolName: string;
  toolLabel: string;
  operation: 'CLIENT' | 'DUMP' | 'RESTORE' | string;
  available: boolean;
  source?: string;
  executable?: string;
  version?: string;
  message?: string;
}

export interface DatabaseToolTestVO {
  success: boolean;
  dbType: string;
  toolName: string;
  executable?: string;
  version?: string;
  message?: string;
  elapsedMs?: number;
}

export interface DatabaseToolSettingsVO {
  baseDirectory: string;
  defaultDirectory: string;
  exists: boolean;
  directory: boolean;
  readable: boolean;
  writable: boolean;
  availableTools: number;
  totalTools: number;
  message?: string;
}

export function getDatabaseToolCatalog() {
  return request({
    url: toolUrl + 'catalog',
    method: 'get',
  });
}

export function getDatabaseToolSettings() {
  return request({
    url: toolUrl + 'settings',
    method: 'get',
  });
}

export function updateDatabaseToolSettings(data: { baseDirectory: string }) {
  return request({
    url: toolUrl + 'settings',
    method: 'post',
    data,
  });
}

export function uploadDatabaseTool(form: FormData) {
  return request({
    url: toolUrl + 'upload',
    method: 'post',
    data: form,
    timeout: 0,
  });
}

export function testDatabaseTool(data: {
  dbType: string;
  toolName: string;
}) {
  return request({
    url: toolUrl + 'test',
    method: 'post',
    data,
  });
}

export function startNativeDatabaseImport(form: FormData) {
  return request({
    url: toolUrl + 'import',
    method: 'post',
    data: form,
    timeout: 0,
  });
}

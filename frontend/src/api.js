export const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

export function query(path, values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  return params.size ? path + '?' + params : path;
}

export async function api(path, { token, method = 'GET', body, signal, blob = false } = {}) {
  const headers = new Headers();
  if (token) headers.set('Authorization', 'Bearer ' + token);
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(apiBase + path, { method, headers, body, signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Não foi possível conectar à API. Confira se o backend está em execução.');
  }
  if (response.status === 204) return null;
  if (response.ok && blob) return response.blob();
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const detail = data?.error?.details?.[0];
    const message = detail ? detail.campo + ': ' + detail.mensagem : data?.error?.message;
    throw Object.assign(new Error(message || 'A API não respondeu como esperado.'), {
      status: response.status,
      code: data?.error?.code,
    });
  }
  return data;
}

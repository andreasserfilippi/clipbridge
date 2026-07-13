const BLOB_UPLOAD_BASE = 'https://blob.vercel-storage.com/';

// Server-side upload, used to store the converted JPEG. Sync clients upload
// their original file directly to this same endpoint (see README) so the
// large transfer never has to pass through this API's request body limit.
async function uploadToBlob(buffer, filename) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set on the server');
  }

  const res = await fetch(BLOB_UPLOAD_BASE + filename, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: buffer,
  });

  if (!res.ok) {
    throw new Error('Blob upload failed: HTTP ' + res.status);
  }

  const data = await res.json();
  return data.url;
}

// Fetches the raw bytes of an image entry's content, whether it's a Blob
// URL (current clients) or legacy inline base64 (older/small entries).
async function getImageBuffer(content) {
  if (content.startsWith('http://') || content.startsWith('https://')) {
    const res = await fetch(content);
    if (!res.ok) {
      throw new Error('Failed to fetch source image: HTTP ' + res.status);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  return Buffer.from(content, 'base64');
}

module.exports = { uploadToBlob, getImageBuffer };

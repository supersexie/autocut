import { createReadStream, createWriteStream } from 'node:fs';
import { link, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { pipeline as streamTo } from 'node:stream/promises';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

// Where videos live. Production: a Cloudflare R2 bucket (S3 API). Phones upload straight to it
// and download straight from it with short-lived signed links, so video never passes through our
// servers, and every take, source, export and preview is kept until the account is deleted.
// Development: a folder, with the API server standing in for R2's signed links (/blobs/<token>).
//
// Keys: users/<user>/uploads/<upload id>       a take, song, photo or clip as the phone sent it
//       users/<user>/cuts/<cut>/source.mp4      takes joined (when there was more than one)
//       users/<user>/cuts/<cut>/render-<id>.mp4 exports
//       users/<user>/cuts/<cut>/preview-<k>.mp4 the editor's stitched previews
export const LINK_SECONDS = 3600;

export function openStorage({ dir, env = process.env } = {}) {
  if (env.R2_BUCKET && env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) return r2Storage(env);
  return localStorage(dir);
}

const contentDisposition = (filename) => (filename ? `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"` : undefined);

async function r2Storage(env) {
  const s3 = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const client = new s3.S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  const Bucket = env.R2_BUCKET;
  return {
    kind: 'r2',
    signPut: (key, type) => getSignedUrl(client, new s3.PutObjectCommand({ Bucket, Key: key, ContentType: type }), { expiresIn: LINK_SECONDS }),
    signGet: (key, { filename } = {}) =>
      getSignedUrl(client, new s3.GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: contentDisposition(filename) }), { expiresIn: LINK_SECONDS }),
    async size(key) {
      try {
        return (await client.send(new s3.HeadObjectCommand({ Bucket, Key: key }))).ContentLength ?? 0;
      } catch (e) {
        if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return null;
        throw e;
      }
    },
    async put(file, key, type) {
      const { size } = await stat(file);
      await client.send(new s3.PutObjectCommand({ Bucket, Key: key, Body: createReadStream(file), ContentLength: size, ContentType: type }));
      return size;
    },
    /** Streams an object (or a byte range of it) for clients that can't follow a signed link. */
    async read(key, range) {
      const out = await client.send(new s3.GetObjectCommand({ Bucket, Key: key, Range: range }));
      return { body: out.Body, size: Number(out.ContentRange?.split('/')[1] ?? out.ContentLength), length: out.ContentLength, range: out.ContentRange, type: out.ContentType };
    },
    async fetchTo(key, file) {
      const out = await client.send(new s3.GetObjectCommand({ Bucket, Key: key }));
      await streamTo(out.Body, createWriteStream(file));
    },
    async removePrefix(prefix) {
      let token;
      do {
        const page = await client.send(new s3.ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key }));
        if (keys.length) await client.send(new s3.DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
  };
}

function localStorage(dir) {
  const root = path.resolve(dir);
  const secret = process.env.BLOB_SECRET || randomBytes(32).toString('hex');
  const fileOf = (key) => {
    const file = path.resolve(root, key);
    if (!file.startsWith(root + path.sep)) throw new Error('bad key');
    return file;
  };
  // A signed token standing in for R2's signed URLs: which key, PUT or GET, and until when.
  const sign = (key, method, extra = {}) => {
    const body = Buffer.from(JSON.stringify({ k: key, m: method, e: Date.now() + LINK_SECONDS * 1000, ...extra })).toString('base64url');
    return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
  };
  return {
    kind: 'local',
    root,
    fileOf,
    // `base` is this server's own address as the phone sees it.
    signPut: async (key, type, base) => `${base}/blobs/${sign(key, 'PUT', { t: type })}`,
    signGet: async (key, { filename, base } = {}) => `${base}/blobs/${sign(key, 'GET', { f: filename })}`,
    /** The key and method a /blobs token was signed for, or null if it's forged or expired. */
    verify(token) {
      const [body, mac] = String(token).split('.');
      if (!body || !mac) return null;
      const good = createHmac('sha256', secret).update(body).digest();
      const given = Buffer.from(mac, 'base64url');
      if (given.length !== good.length || !timingSafeEqual(given, good)) return null;
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
      return claims.e > Date.now() ? claims : null;
    },
    size: async (key) => (await stat(fileOf(key)).catch(() => null))?.size ?? null,
    async put(file, key) {
      const dest = fileOf(key);
      await mkdir(path.dirname(dest), { recursive: true });
      await rename(file, dest).catch(async () => streamTo(createReadStream(file), createWriteStream(dest)));
      return (await stat(dest)).size;
    },
    async write(stream, key) {
      const dest = fileOf(key);
      await mkdir(path.dirname(dest), { recursive: true });
      const part = `${dest}.${randomBytes(4).toString('hex')}.part`;
      await streamTo(stream, createWriteStream(part));
      await rename(part, dest);
      return (await stat(dest)).size;
    },
    async fetchTo(key, file) {
      await link(fileOf(key), file).catch(() => streamTo(createReadStream(fileOf(key)), createWriteStream(file)));
    },
    async removePrefix(prefix) {
      await rm(fileOf(prefix.replace(/\/$/, '')), { recursive: true, force: true });
    },
    list: async (prefix) => readdir(fileOf(prefix)).catch(() => []),
  };
}

/**
 * Keeps recently used files on this machine (a cut's source, mostly), so a preview or export
 * right after another doesn't fetch hundreds of MB again. Oldest go first past `maxBytes`.
 */
export function fileCache(storage, dir, maxBytes = Number(process.env.CACHE_GB ?? 8) * 1e9) {
  return {
    async get(key) {
      if (storage.kind === 'local') return storage.fileOf(key); // already on this disk
      const ext = path.extname(key) || '.bin';
      const file = path.join(dir, createHash('sha1').update(key).digest('hex') + ext);
      if (await stat(file).catch(() => null)) return file;
      await mkdir(dir, { recursive: true });
      const part = `${file}.${randomBytes(4).toString('hex')}.part`;
      await storage.fetchTo(key, part);
      await rename(part, file);
      trim(dir, maxBytes).catch(() => {});
      return file;
    },
  };
}

async function trim(dir, maxBytes) {
  const files = await Promise.all((await readdir(dir)).filter((f) => !f.endsWith('.part')).map(async (f) => ({ f, s: await stat(path.join(dir, f)) })));
  let total = files.reduce((t, x) => t + x.s.size, 0);
  for (const { f, s } of files.sort((a, b) => a.s.atimeMs - b.s.atimeMs)) {
    if (total <= maxBytes) break;
    await rm(path.join(dir, f), { force: true });
    total -= s.size;
  }
}

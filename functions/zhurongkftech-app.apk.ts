type R2StoredObjectLike = {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  writeHttpMetadata?: (headers: Headers) => void;
};

type R2BucketLike = {
  get: (key: string) => Promise<R2StoredObjectLike | null>;
};

type Env = {
  R2_BUCKET?: R2BucketLike;
  YICH_R2?: R2BucketLike;
  ASSETS_BUCKET?: R2BucketLike;
};

type PagesFunction<Bindings> = (context: {
  request: Request;
  env: Bindings;
}) => Response | Promise<Response>;

const androidApkR2Key = "releases/zhurongkftech-app.apk";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const bucket = env.R2_BUCKET ?? env.YICH_R2 ?? env.ASSETS_BUCKET;
  const object = bucket ? await bucket.get(androidApkR2Key) : null;
  if (!object) {
    return new Response("安装包暂不可用", {
      status: 404,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  const headers = new Headers({
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Content-Disposition": 'attachment; filename="zhurongkftech-app.apk"',
    "Content-Type": "application/vnd.android.package-archive",
    "X-Content-Type-Options": "nosniff",
  });
  object.writeHttpMetadata?.(headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("Content-Disposition", 'attachment; filename="zhurongkftech-app.apk"');
  headers.set("Content-Type", "application/vnd.android.package-archive");

  return new Response(request.method === "HEAD" ? null : object.body, { headers });
};

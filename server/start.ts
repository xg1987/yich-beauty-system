import { createApiServer } from "./api";

const port = Number(process.env.PORT ?? 8787);

createApiServer().listen(port, () => {
  console.log(`Zhurong Kunfeng system API listening on http://localhost:${port}`);
});

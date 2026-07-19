export type EmbeddedClientAsset = {
  contentType: string;
  encoding: "utf8" | "base64";
  body: string;
};

export const embeddedClientAssets: Record<string, EmbeddedClientAsset> = {};

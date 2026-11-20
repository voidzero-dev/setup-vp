// SHA-256 digests from the SocketDev/sfw-free GitHub release assets.
const sfwReleaseDigests = {
  "v1.15.4": {
    "sfw-free-linux-arm64": "c8c80aa582829f24f5d633f2c3f2ccd0b070bbee80bf3b956e5e2a9880184e20",
    "sfw-free-linux-x86_64": "cf9f55b8343e1ef6e6dcccdb09b99c70c0430a22ed7d0079286eccddeaf72670",
    "sfw-free-macos-arm64": "1b705ea7c399727ee41aa93f63e0469d2c3787c50e1dd8842cb8ff5ceec9eb99",
    "sfw-free-macos-x86_64": "b19f96f0dd3ebc4ecc7111dbc43cc2b095f37bf759273c0bd9c0c4784ea24731",
    "sfw-free-musl-linux-arm64": "596b1f65cb8ae978cb093f7b9af75784f67e2d30a02c70567c59536b6f34e3a6",
    "sfw-free-musl-linux-x86_64":
      "e766e2767e6bbfd1ddf66a5e32a75363742d98c40d3827c330dd14b8ea179249",
    "sfw-free-windows-arm64.exe":
      "16607f9c64055b8e0af918dc93a72a342ca8352f46e6e3f810d1a378a380a82a",
    "sfw-free-windows-x86_64.exe":
      "f8c94fc5e41d49c51d2fd013c2c169274df9c483fc763d8c82ff71c5579d3bb0",
  },
} as const;

export type SfwAsset = keyof (typeof sfwReleaseDigests)[keyof typeof sfwReleaseDigests];

export function getSfwAssetDigest(
  version: keyof typeof sfwReleaseDigests,
  asset: SfwAsset,
): string {
  return sfwReleaseDigests[version][asset];
}

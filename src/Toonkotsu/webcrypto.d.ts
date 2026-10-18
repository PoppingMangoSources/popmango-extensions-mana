/* SPDX-License-Identifier: GPL-3.0-or-later */

// The package's root browser shim expects external globals; this entry bundles its providers.
declare module "webcrypto-liner/build/index.es.js" {
  export const crypto: { subtle: unknown };
}

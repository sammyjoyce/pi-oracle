// Purpose: Keep pi project-trust probing behind one typed extension-side helper.

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type LegacyProjectTrustContext = ExtensionContext & {
  isProjectTrusted?: () => boolean;
};

export function isOracleProjectTrusted(ctx: ExtensionContext): boolean {
  const isProjectTrusted = (ctx as LegacyProjectTrustContext).isProjectTrusted;
  return typeof isProjectTrusted === "function" ? isProjectTrusted.call(ctx) : true;
}

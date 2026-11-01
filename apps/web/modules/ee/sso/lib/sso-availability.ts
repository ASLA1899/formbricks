import "server-only";
import {
  AZURE_OAUTH_ENABLED,
  GITHUB_OAUTH_ENABLED,
  GOOGLE_OAUTH_ENABLED,
  OIDC_OAUTH_ENABLED,
  SAML_OAUTH_ENABLED,
} from "@/lib/constants";
import { getIsSamlSsoEnabled, getIsSsoEnabled } from "@/modules/ee/license-check/lib/utils";
import type { TSsoIdentityProvider } from "./provider-normalization";

export type TSsoAvailability = {
  /** Whether the login and signup pages show the SSO block: the licence's `sso` feature, or Microsoft (ASLA fork). */
  readonly isSsoEnabled: boolean;
  /** Whether each provider's button is offered: licensed AND configured on this instance. */
  readonly providers: Readonly<Record<TSsoIdentityProvider, boolean>>;
};

/**
 * Which SSO sign-in options this instance offers right now — the one place that decides it, so the
 * login and signup pages and any copy that points a user at a provider cannot disagree.
 *
 * Every provider sits behind the `sso` feature; SAML additionally needs `saml`.
 */
export const getSsoAvailability = async (): Promise<TSsoAvailability> => {
  const [isSsoEnabled, isSamlSsoEnabled] = await Promise.all([getIsSsoEnabled(), getIsSamlSsoEnabled()]);

  // ASLA fork: Microsoft (Entra) sign-in does not need the enterprise license, so its button is offered
  // whenever it is configured, and the SSO block is shown for it even when the `sso` feature is off.
  // Every other provider still needs the license.
  return {
    isSsoEnabled: isSsoEnabled || AZURE_OAUTH_ENABLED,
    providers: {
      google: isSsoEnabled && GOOGLE_OAUTH_ENABLED,
      github: isSsoEnabled && GITHUB_OAUTH_ENABLED,
      azuread: AZURE_OAUTH_ENABLED,
      openid: isSsoEnabled && OIDC_OAUTH_ENABLED,
      saml: isSsoEnabled && isSamlSsoEnabled && SAML_OAUTH_ENABLED,
    },
  };
};

/** The SSO props the login and signup forms take, in the shape they take them. */
export const toSsoFormProps = ({ isSsoEnabled, providers }: TSsoAvailability) => ({
  isSsoEnabled,
  googleOAuthEnabled: providers.google,
  githubOAuthEnabled: providers.github,
  azureOAuthEnabled: providers.azuread,
  oidcOAuthEnabled: providers.openid,
  samlSsoEnabled: providers.saml,
});

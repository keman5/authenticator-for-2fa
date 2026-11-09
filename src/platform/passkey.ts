import { detectBrowserLanguage } from '../lib/i18n/languages';
import { t } from '../lib/i18n/messages';
/** A PRF credential wraps a random verification token bound to the screen-lock proof. */
const STORAGE_KEY = 'keman5.authenticator.workspace.passkey.v2';
interface PasskeyRecord {
  version: 1;
  credentialId: string;
  rpId?: string;
  salt: string;
  iv: string;
  wrappedKey: string;
  fingerprint: string;
}
type PrfExtensions = AuthenticationExtensionsClientInputs & {
  prf: { eval: { first: ArrayBuffer } };
};
type PrfCredential = PublicKeyCredential & {
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs & {
    prf?: { enabled?: boolean; results?: { first: ArrayBuffer } };
  };
};
const encode = (value: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(value)));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0)).buffer;
export function loadPasskeyRecord(): PasskeyRecord | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? 'null'
    ) as PasskeyRecord | null;
    return value?.version === 1 &&
      typeof value.credentialId === 'string' &&
      typeof value.wrappedKey === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
}
export function removePasskey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Optional credential metadata must never prevent vault cleanup. */
  }
}
/** Request Firefox's RP permission while the Register click still has user activation. */
export async function requestPasskeyAccess(): Promise<string | undefined> {
  if (typeof location === 'undefined' || location.protocol !== 'moz-extension:')
    return undefined;
  const rpId = 'macseek.cc';
  if (!(await chrome.permissions.request({ origins: [`https://${rpId}/*`] })))
    throw new Error(
      'Passkey registration requires site permission for macseek.cc.'
    );
  return rpId;
}
async function deriveWrappingKey(
  credential: PrfCredential | null
): Promise<CryptoKey> {
  const output = credential?.getClientExtensionResults().prf?.results?.first;
  if (!output)
    throw new Error(
      'This passkey cannot protect the vault: WebAuthn PRF is unavailable. Use the vault password.'
    );
  const digest = await crypto.subtle.digest('SHA-256', output);
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, [
    'encrypt',
    'decrypt'
  ]);
}
async function request(
  record: Pick<PasskeyRecord, 'credentialId' | 'salt' | 'rpId'>
): Promise<PrfCredential> {
  if (!navigator.credentials)
    throw new Error(
      'Passkeys are unavailable in this extension origin. Use the vault password.'
    );
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      ...(record.rpId ? { rpId: record.rpId } : {}),
      allowCredentials: [
        { type: 'public-key', id: decode(record.credentialId) }
      ],
      userVerification: 'required',
      timeout: 60000,
      extensions: {
        prf: { eval: { first: decode(record.salt) } }
      } as PrfExtensions
    }
  })) as PrfCredential | null;
  if (!credential || encode(credential.rawId) !== record.credentialId)
    throw new Error(
      'Passkey verification was cancelled or returned a different credential.'
    );
  return credential;
}
export async function enrollPasskey(
  rawKey: ArrayBuffer,
  fingerprint: string,
  rpId?: string,
  language: string = detectBrowserLanguage()
): Promise<void> {
  if (!navigator.credentials)
    throw new Error(
      'Passkeys are unavailable in this extension origin. Use the vault password.'
    );
  const salt = crypto.getRandomValues(new Uint8Array(32)).buffer;
  const accountName = t(language, 'passkeyAccountName');
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Authenticator - 2FA', ...(rpId ? { id: rpId } : {}) },
      user: {
        id: crypto.getRandomValues(new Uint8Array(32)),
        name: accountName,
        displayName: accountName
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 }
      ],
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required'
      },
      timeout: 60000,
      attestation: 'none',
      extensions: { prf: { eval: { first: salt } } } as PrfExtensions
    }
  })) as PrfCredential | null;
  if (!credential) throw new Error('Passkey registration was cancelled.');
  const reference = {
    ...(rpId ? { rpId } : {}),
    credentialId: encode(credential.rawId),
    salt: encode(salt)
  };
  const evaluated = credential.getClientExtensionResults().prf?.results?.first
    ? credential
    : await request(reference);
  const wrappingKey = await deriveWrappingKey(evaluated);
  const iv = crypto.getRandomValues(new Uint8Array(12)).buffer;
  const wrappedKey = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(fingerprint)
    },
    wrappingKey,
    rawKey
  );
  const record: PasskeyRecord = {
    version: 1,
    ...reference,
    iv: encode(iv),
    wrappedKey: encode(wrappedKey),
    fingerprint
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}
export async function readPasskeyKey(
  fingerprint: string
): Promise<ArrayBuffer> {
  const record = loadPasskeyRecord();
  if (!record || record.fingerprint !== fingerprint)
    throw new Error(
      'No passkey is registered for this vault. Unlock with its password and register again.'
    );
  const wrappingKey = await deriveWrappingKey(await request(record));
  return crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: decode(record.iv),
      additionalData: new TextEncoder().encode(fingerprint)
    },
    wrappingKey,
    decode(record.wrappedKey)
  );
}

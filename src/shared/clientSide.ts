/** API calls that act on the user's own computer; a browser client does these itself or refuses, and nothing remote may ask the app to. */
export const CLIENT_SIDE = ['chooseFolder', 'openFolder', 'openExternal', 'copyText', 'readClipboard'] as const;

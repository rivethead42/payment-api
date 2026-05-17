let appReady = false;

export function setAppReady(value: boolean): void {
  appReady = value;
}

export function isAppReady(): boolean {
  return appReady;
}

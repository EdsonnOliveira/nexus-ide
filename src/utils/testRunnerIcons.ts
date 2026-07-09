import logoDetox from '@/assets/logo-detox.png';
import logoJest from '@/assets/logo-jest.svg';
import logoMaestro from '@/assets/logo-maestro.png';
import logoPlaywright from '@/assets/logo-playwright.svg';
import logoVitest from '@/assets/logo-vitest.svg';
import type { TestRunnerKind } from '@/types/test';

export const TEST_RUNNER_ICON_SRC: Record<TestRunnerKind, string> = {
  maestro: logoMaestro,
  jest: logoJest,
  vitest: logoVitest,
  playwright: logoPlaywright,
  detox: logoDetox,
};

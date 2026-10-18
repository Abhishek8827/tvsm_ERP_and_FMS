import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
// vitest runs with globals off, so testing-library will not unmount between tests on its own.
afterEach(() => cleanup());

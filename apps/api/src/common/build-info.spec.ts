import { readBuildInfo } from './build-info';

describe('readBuildInfo', () => {
  it('usa la versión y el commit de la imagen publicada', () => {
    expect(readBuildInfo({ APP_VERSION: '1.2.3', GIT_SHA: 'abc123', BUILD_DATE: '2026-10-23T00:00:00Z' })).toEqual({
      version: '1.2.3',
      commit: 'abc123',
      builtAt: '2026-10-23T00:00:00Z',
    });
  });

  it('en desarrollo toma la versión del package.json', () => {
    expect(readBuildInfo({}).version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('no falla si no encuentra el package.json', () => {
    expect(readBuildInfo({}, '/no/existe/package.json')).toEqual({ version: '0.0.0-dev', commit: null, builtAt: null });
  });
});

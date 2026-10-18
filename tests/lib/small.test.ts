import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from '../../src/lib/duration';
import { countGated, parseFailOn } from '../../src/lib/fail-on';
import { appendGithubOutput } from '../../src/lib/github-output';
import { captureTestEnv } from '../helpers';

describe('parseDuration', () => {
  it('understands units and bare seconds', () => {
    expect(parseDuration('120s')).toBe(120_000);
    expect(parseDuration('5m')).toBe(300_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('250ms')).toBe(250);
    expect(parseDuration('90')).toBe(90_000);
    expect(parseDuration('1.5m')).toBe(90_000);
  });
  it('rejects garbage', () => {
    expect(() => parseDuration('soon')).toThrow(/Invalid duration/);
    expect(() => parseDuration('5d')).toThrow(/Invalid duration/);
  });
  it('formats back', () => {
    expect(formatDuration(7_200_000)).toBe('2h');
    expect(formatDuration(300_000)).toBe('5m');
    expect(formatDuration(45_000)).toBe('45s');
  });
});

describe('fail-on', () => {
  const results = [
    { status: 'success' },
    { status: 'warning' },
    { status: 'fail' },
    { status: 'error' },
    { status: 'information' },
    { status: 'pending' },
  ];
  it('gates fail|error at "fail" and adds warnings at "warning"', () => {
    expect(countGated(results, 'fail')).toBe(2);
    expect(countGated(results, 'warning')).toBe(3);
  });
  it('validates the level', () => {
    expect(parseFailOn('fail')).toBe('fail');
    expect(() => parseFailOn('info')).toThrow(/Invalid --fail-on/);
  });
});

describe('appendGithubOutput', () => {
  const restore = captureTestEnv();
  afterEach(restore);

  it('is a no-op outside GitHub Actions', () => {
    delete process.env.GITHUB_OUTPUT;
    expect(appendGithubOutput('k', 'v')).toBe(false);
  });
  it('appends key=value lines', () => {
    const file = join(tmpdir(), `gh-output-${process.pid}`);
    writeFileSync(file, 'existing=1\n');
    process.env.GITHUB_OUTPUT = file;
    expect(appendGithubOutput('window_id', 'abc')).toBe(true);
    expect(readFileSync(file, 'utf-8')).toBe('existing=1\nwindow_id=abc\n');
  });
});

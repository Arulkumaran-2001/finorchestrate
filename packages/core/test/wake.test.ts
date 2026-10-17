import { describe, expect, it } from 'vitest';
import { matchWake, parseUtterance, DEFAULT_CATEGORIES, soundKey } from '../src/index.js';

describe('wake phrase', () => {
  it.each([
    ['Hey Fino, how many months of runway do we have?', 'how many months of runway do we have?'],
    ['hey feeno', ''],
    ['okay vino what did I miss', 'what did I miss'],
    ['A fino log 42 dollars for Bedrock inference', 'log 42 dollars for Bedrock inference'],
    ['hey fee no run the guardian', 'run the guardian'],
    ['Hey Phino. Um, any unusual charges?', 'any unusual charges?'],
    ['Fino, approve it', 'approve it'],
    ['FinOrchestrate, forecast the next 6 months', 'forecast the next 6 months'],
    ['hey fin orchestrate whats our runway', 'whats our runway'],
    ['so hey fino can we afford a 600 dollar GPU run', 'can we afford a 600 dollar GPU run'],
    ['hi Fina', ''],
  ])('wakes on "%s"', (transcript, command) => {
    expect(matchWake(transcript)).toMatchObject({ command });
  });

  it.each([
    "I'm fine, thanks",
    'hey find my keys',
    'hey fine',
    'the fino sherry was lovely',
    'hey there',
    'five dollars for coffee',
    'how is the budget looking',
    '',
  ])('stays asleep on "%s"', (transcript) => {
    expect(matchWake(transcript)).toBeNull();
  });

  it('keys words by sound', () => {
    expect(['fino', 'feeno', 'phino', 'vino', 'fyno', 'feenoh'].map(soundKey)).toEqual(Array(6).fill('fino'));
  });

  it('hands the command to the intent engine unchanged', () => {
    const wake = matchWake('Hey Fino, log forty two dollars for Bedrock inference');
    expect(parseUtterance(wake!.command, { categories: DEFAULT_CATEGORIES })).toMatchObject({ tool: 'log_expense', arguments: { amount: 42 } });
  });
});

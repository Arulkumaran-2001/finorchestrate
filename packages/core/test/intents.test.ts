import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES, EXAMPLE_UTTERANCES, extractAmount, parseUtterance, wordsToNumbers } from '../src/index.js';

const context = { categories: DEFAULT_CATEGORIES, now: new Date('2026-10-13T09:00:00Z') };
const parse = (text: string) => parseUtterance(text, context);

describe('number words', () => {
  it.each([
    ['log forty two dollars', 'log 42 dollars'],
    ['twelve hundred for the contractor', '1200 for the contractor'],
    ['two thousand five hundred dollars', '2500 dollars'],
    ['one hundred and twenty bucks', '120 bucks'],
    ['a thousand dollars', '1000 dollars'],
    ['two grand', '2000'],
  ])('%s', (input, expected) => {
    expect(wordsToNumbers(input)).toBe(expected);
  });

  it('prefers explicit money over other numbers', () => {
    expect(extractAmount('in 3 months spend $1,240.50')?.dollars).toBe(1240.5);
    expect(extractAmount('1.2k on ads')?.dollars).toBe(1200);
    expect(extractAmount('forecast the next 6 months')).toBeUndefined();
    expect(extractAmount('if costs go up 25 percent')).toBeUndefined();
  });
});

describe('parseUtterance', () => {
  it('logs an expense and leaves categorisation to the server', () => {
    expect(parse('Alexa, log forty two dollars for Bedrock inference')).toMatchObject({
      tool: 'log_expense',
      arguments: { amount: 42, description: 'Bedrock inference' },
    });
  });

  it('honours an explicit category and a relative date', () => {
    expect(parse('I spent 120 on Figma seats yesterday under tools')).toMatchObject({
      tool: 'log_expense',
      arguments: { amount: 120, description: 'Figma seats', category: 'tooling', occurred_on: '2026-10-12' },
    });
  });

  it('records income', () => {
    expect(parse('We received 4,000 dollars from Northwind for the retainer')).toMatchObject({
      tool: 'log_income',
      arguments: { amount: 4000 },
    });
  });

  it('moves budget between envelopes with a reason', () => {
    expect(parse('Move $300 from the safety reserve to cloud because of the GPU run')).toMatchObject({
      tool: 'move_budget',
      arguments: { from_category: 'reserve', to_category: 'cloud', amount: 300, reason: 'GPU run' },
    });
  });

  it('answers runway and stress questions', () => {
    expect(parse('How many months of runway do we have?')).toMatchObject({ tool: 'get_runway', arguments: {} });
    expect(parse('What if cloud costs go up 25 percent?')).toEqual({
      tool: 'get_runway',
      arguments: { stress_percent: 25, category: 'cloud' },
      understood: 'Runway if Cloud & Infrastructure costs rise 25%',
    });
    expect(parse('how long can we last if spending drops 10%')).toEqual({
      tool: 'get_runway',
      arguments: { stress_percent: -10 },
      understood: 'Runway if spending falls 10%',
    });
    expect(parse('what if contractor spend goes up 20 percent')).toMatchObject({ arguments: { stress_percent: 20, category: 'contractors' } });
    expect(parse('what if costs go up 30%')).toMatchObject({ arguments: { stress_percent: 30 } });
    expect(parse('what if costs go up 30%')!.arguments).not.toHaveProperty('category');
  });

  it('forecasts with a horizon', () => {
    expect(parse('Forecast the next 6 months')).toMatchObject({ tool: 'forecast_cash', arguments: { months: 6 } });
    expect(parse('where will we be in a year')).toMatchObject({ tool: 'forecast_cash', arguments: { months: 12 } });
  });

  it('checks affordability, including recurring costs', () => {
    expect(parse('Can we afford a 600 dollar GPU run?')).toMatchObject({
      tool: 'check_affordability',
      arguments: { amount: 600, description: 'GPU run', recurring: false, category: 'cloud' },
    });
    expect(parse('can I afford 49 dollars a month for Postman')).toMatchObject({
      tool: 'check_affordability',
      arguments: { amount: 49, recurring: true },
    });
  });

  it('routes approvals without confusing listing and approving', () => {
    expect(parse('anything to approve?')).toMatchObject({ tool: 'list_approvals' });
    expect(parse('Approve it')).toMatchObject({ tool: 'resolve_approval', arguments: { decision: 'approve' } });
    expect(parse('yes, go ahead')).toMatchObject({ tool: 'resolve_approval', arguments: { decision: 'approve' } });
    expect(parse('reject that')).toMatchObject({ tool: 'resolve_approval', arguments: { decision: 'reject' } });
  });

  it('covers audits, briefings, guardian and status', () => {
    expect(parse('Any unusual charges?')).toMatchObject({ tool: 'audit_spending' });
    expect(parse('were we charged twice for anything')).toMatchObject({ tool: 'audit_spending' });
    expect(parse('What did I miss?')).toMatchObject({ tool: 'get_briefing' });
    expect(parse('what did the guardian do')).toMatchObject({ tool: 'get_briefing' });
    expect(parse('run the guardian')).toMatchObject({ tool: 'run_guardian' });
    expect(parse('How much is left in cloud?')).toMatchObject({ tool: 'get_budget_status', arguments: { category: 'cloud' } });
    expect(parse('how is the budget looking')).toMatchObject({ tool: 'get_budget_status', arguments: {} });
  });

  it('returns null for unrelated speech', () => {
    expect(parse('play some jazz')).toBeNull();
    expect(parse('')).toBeNull();
  });

  it('understands every example shown in the console', () => {
    for (const example of EXAMPLE_UTTERANCES) expect(parse(example), example).not.toBeNull();
  });
});

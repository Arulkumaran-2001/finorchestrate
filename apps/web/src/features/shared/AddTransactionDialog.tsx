import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { classifyExpense, DEFAULT_CATEGORIES } from '@finorchestrate/core';
import { categoryIcons } from '@finorchestrate/icons';
import { Button } from '../../components/Button';
import { Field, MoneyInput, Segmented, Select, TextInput, type SelectOption } from '../../components/forms';
import { Dialog, useToast } from '../../components/overlays';
import { CATEGORIES_QUERY, LOG_EXPENSE, LOG_INCOME, type CategoryDefinition } from '../../lib/api';
import { parseMoneyInput } from '../../lib/format';
import { useMutation, useQuery } from '../../lib/graphql';

type Kind = 'expense' | 'income';
type When = 'today' | 'yesterday' | 'two-days';

export function AddTransactionDialog({ open, onClose, initialKind = 'expense' }: { open: boolean; onClose: () => void; initialKind?: Kind }) {
  const toast = useToast();
  const categories = useQuery<{ categories: CategoryDefinition[] }>(CATEGORIES_QUERY);
  const expense = useMutation<{ logExpense: { speech: string } }>(LOG_EXPENSE);
  const income = useMutation<{ logIncome: { speech: string } }>(LOG_INCOME);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('auto');
  const [when, setWhen] = useState<When>('today');
  const [errors, setErrors] = useState<{ amount?: string; description?: string; form?: string }>({});

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setAmount('');
    setDescription('');
    setCategory('auto');
    setWhen('today');
    setErrors({});
  }, [open, initialKind]);

  const list = categories.data?.categories ?? [];
  const suggestion = useMemo(() => {
    if (!description.trim()) return null;
    const result = classifyExpense(description, (list.length ? list : DEFAULT_CATEGORIES) as never);
    return list.find((entry) => entry.id === result.categoryId)?.name ?? null;
  }, [description, list]);

  const options: SelectOption[] = [
    { value: 'auto', label: 'Detect automatically', description: suggestion ? `Looks like ${suggestion}` : 'From the description', icon: 'search' },
    ...list.map((entry) => ({ value: entry.id, label: entry.name, tone: entry.tone, icon: categoryIcons[entry.id] })),
  ];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cents = parseMoneyInput(amount);
    const next: typeof errors = {};
    if (cents === null) next.amount = 'Enter an amount such as 42.50';
    if (!description.trim()) next.description = 'Say what it was for';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const days = when === 'today' ? 0 : when === 'yesterday' ? 1 : 2;
    const occurredAt = days === 0 ? undefined : new Date(Date.now() - days * 86_400_000).toISOString();
    try {
      if (kind === 'expense') {
        const result = await expense.run({
          input: { amountCents: cents, description: description.trim(), ...(category !== 'auto' ? { category } : {}), ...(occurredAt ? { occurredAt } : {}) },
        });
        toast({ title: 'Expense logged', detail: result.logExpense.speech, tone: result.logExpense.speech.includes('Heads up') ? 'warning' : 'success' });
      } else {
        const result = await income.run({ input: { amountCents: cents, description: description.trim(), ...(occurredAt ? { occurredAt } : {}) } });
        toast({ title: 'Income recorded', detail: result.logIncome.speech, tone: 'success' });
      }
      onClose();
    } catch (error) {
      setErrors({ form: (error as Error).message });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={kind === 'expense' ? 'Log an expense' : 'Record income'}
      description="It lands in the ledger, the guardian and every connected voice client at once."
      icon={kind === 'expense' ? 'expense' : 'income'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-transaction" loading={expense.pending || income.pending}>
            {kind === 'expense' ? 'Log expense' : 'Record income'}
          </Button>
        </>
      }
    >
      <form id="add-transaction" className="form-stack" onSubmit={submit} noValidate>
        <Segmented<Kind>
          label="Type"
          stretch
          value={kind}
          onChange={setKind}
          options={[
            { value: 'expense', label: 'Expense', icon: 'expense' },
            { value: 'income', label: 'Income', icon: 'income' },
          ]}
        />
        <div className="form-row">
          <Field label="Amount" error={errors.amount}>
            {({ inputId, describedBy, invalid }) => (
              <MoneyInput id={inputId} aria-describedby={describedBy} invalid={invalid} value={amount} onChange={(event) => setAmount(event.target.value)} data-autofocus />
            )}
          </Field>
          <Field label="When">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={when}
                onChange={(value) => setWhen(value as When)}
                options={[
                  { value: 'today', label: 'Today', icon: 'calendar' },
                  { value: 'yesterday', label: 'Yesterday', icon: 'calendar' },
                  { value: 'two-days', label: 'Two days ago', icon: 'calendar' },
                ]}
              />
            )}
          </Field>
        </div>
        <Field label={kind === 'expense' ? 'What was it for' : 'Who paid'} error={errors.description} hint={kind === 'expense' ? 'Merchant names like AWS, GitHub or Datadog are recognised.' : undefined}>
          {({ inputId, describedBy, invalid }) => (
            <TextInput
              id={inputId}
              aria-describedby={describedBy}
              invalid={invalid}
              maxLength={140}
              placeholder={kind === 'expense' ? 'Bedrock inference for the demo' : 'Northwind Retail retainer'}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
        {kind === 'expense' ? (
          <Field label="Envelope">
            {({ inputId }) => <Select id={inputId} value={category} onChange={setCategory} options={options} />}
          </Field>
        ) : null}
        {errors.form ? (
          <p className="form-error" role="alert">
            {errors.form}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

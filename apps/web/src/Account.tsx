import {Button, Field, Input, PageHeader, Stack, Text} from '@earendil-works/elanor-react';
import {useState, type ReactNode} from 'react';
import {LoginIcon, LogoutIcon, ViewInArIcon} from './icons.ts';

// shortcut: mock auth, password kept in plain localStorage; replace with a real backend before any real users.
export interface Account {
  username: string;
  password: string;
  name: string;
  email: string;
}
export const demoAccount: Account = {username: 'demo', password: 'brim', name: 'Demo User', email: 'demo@brim.local'};

export function Login({account, onLogin}: {account: Account; onLogin: () => void}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = () =>
    username.trim() === account.username && password === account.password
      ? onLogin()
      : setError('Wrong username or password.');
  return (
    <main className="login">
      <form className="login-card" onSubmit={(e) => (e.preventDefault(), submit())}>
        <Stack gap="large" align="stretch">
          <Stack direction="row" gap="small" align="center">
            <ViewInArIcon size={24} />
            <Text render={<strong />}>Brim</Text>
          </Stack>
          <PageHeader.Root>
            <PageHeader.Row>
              <PageHeader.Title level={1}>Sign in</PageHeader.Title>
            </PageHeader.Row>
            <PageHeader.Description>
              Demo login: <strong>{demoAccount.username}</strong> / <strong>{demoAccount.password}</strong>
            </PageHeader.Description>
          </PageHeader.Root>
          <Field.Root name="username" invalid={!!error}>
            <Field.Label>Username</Field.Label>
            <Input
              autoFocus
              autoComplete="username"
              value={username}
              onValueChange={(v) => (setUsername(v), setError(''))}
            />
          </Field.Root>
          <Field.Root name="password" invalid={!!error}>
            <Field.Label>Password</Field.Label>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onValueChange={(v) => (setPassword(v), setError(''))}
            />
            {error && <Field.Error match>{error}</Field.Error>}
          </Field.Root>
          <Button type="submit" iconStart={<LoginIcon />}>
            Sign in
          </Button>
        </Stack>
      </form>
    </main>
  );
}

export function AccountSettings({
  account,
  setAccount,
  onLogout,
}: {
  account: Account;
  setAccount: (a: Account) => void;
  onLogout: () => void;
}) {
  const [draft, setDraft] = useState({name: account.name, email: account.email, current: '', next: '', confirm: ''});
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const changingPassword = !!(draft.current || draft.next || draft.confirm);
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) {
    errors.name = 'Enter a name.';
  }
  if (!/^\S+@\S+\.\S+$/.test(draft.email.trim())) {
    errors.email = 'Enter a valid email.';
  }
  if (changingPassword) {
    if (draft.current !== account.password) {
      errors.current = 'Current password is wrong.';
    }
    if (draft.next.length < 4) {
      errors.next = 'Use at least 4 characters.';
    }
    if (draft.confirm !== draft.next) {
      errors.confirm = 'Passwords do not match.';
    }
  }
  const shown = tried ? errors : {};
  const set = (k: keyof typeof draft) => (v: string) => (setDraft((d) => ({...d, [k]: v})), setSaved(false));
  const save = () => {
    setTried(true);
    if (Object.keys(errors).length) {
      return;
    }
    setAccount({
      ...account,
      name: draft.name.trim(),
      email: draft.email.trim(),
      password: changingPassword ? draft.next : account.password,
    });
    setDraft((d) => ({...d, current: '', next: '', confirm: ''}));
    setTried(false);
    setSaved(true);
  };
  const field = (k: keyof typeof draft, label: string, control: ReactNode) => (
    <Field.Root name={k} invalid={!!shown[k]}>
      <Field.Label>{label}</Field.Label>
      {control}
      {shown[k] && <Field.Error match>{shown[k]}</Field.Error>}
    </Field.Root>
  );

  return (
    <Stack gap="xLarge" align="stretch">
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>Account</PageHeader.Title>
          <PageHeader.Actions>
            <Button hierarchy="secondary" iconStart={<LogoutIcon />} onClick={onLogout}>
              Sign out
            </Button>
          </PageHeader.Actions>
        </PageHeader.Row>
        <PageHeader.Description>Signed in as {account.username}.</PageHeader.Description>
      </PageHeader.Root>
      <form className="editor" onSubmit={(e) => (e.preventDefault(), save())}>
        <Stack gap="large" align="stretch">
          {field('name', 'Display name', <Input autoComplete="name" value={draft.name} onValueChange={set('name')} />)}
          {field(
            'email',
            'Email',
            <Input type="email" autoComplete="email" value={draft.email} onValueChange={set('email')} />,
          )}
          <Text render={<strong />}>Change password</Text>
          {field(
            'current',
            'Current password',
            <Input
              type="password"
              autoComplete="current-password"
              value={draft.current}
              onValueChange={set('current')}
            />,
          )}
          {field(
            'next',
            'New password',
            <Input type="password" autoComplete="new-password" value={draft.next} onValueChange={set('next')} />,
          )}
          {field(
            'confirm',
            'Confirm new password',
            <Input type="password" autoComplete="new-password" value={draft.confirm} onValueChange={set('confirm')} />,
          )}
          <Stack direction="row" gap="small" align="center">
            <Button type="submit">Save</Button>
            {saved && (
              <Text className="muted" role="status">
                Saved.
              </Text>
            )}
          </Stack>
        </Stack>
      </form>
    </Stack>
  );
}

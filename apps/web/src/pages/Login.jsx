import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { SOFTWARE } from '@erp/shared';
import { useAuth } from '../auth/AuthContext';

const loginTheme = createTheme({
  palette: {
    primary: { main: '#2B5A8C', dark: '#1F3A5F' },
    background: { default: '#F5F7FA', paper: '#FFFFFF' },
    text: { primary: '#14202E', secondary: '#5C6C7E' },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: 'Roboto, Arial, sans-serif',
    button: { fontWeight: 600, textTransform: 'none' },
  },
});

export function Login() {
  const { signIn, notice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    const next = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
      next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setFormError(err.message);
      setBusy(false);
    }
  }

  return (
    <ThemeProvider theme={loginTheme}>
      <Box
        component="main"
        sx={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          px: 2,
          py: 4,
          bgcolor: 'background.default',
          backgroundImage: 'radial-gradient(ellipse at top, rgba(43,90,140,.07), transparent 55%)',
        }}
      >
        <Stack spacing={2} sx={{ width: '100%', maxWidth: 420 }}>
          <Paper
            component="form"
            onSubmit={onSubmit}
            noValidate
            elevation={0}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2.5,
              p: { xs: 3, sm: 4 },
              border: '1px solid',
              borderColor: 'rgba(20,40,63,.1)',
              borderRadius: 3,
              boxShadow: '0 12px 36px rgba(20,40,63,.07)',
            }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box
                component="img"
                src="/logo.jpg"
                alt="TVSM School logo"
                sx={{
                  width: 48,
                  height: 48,
                  objectFit: 'contain',
                  borderRadius: 1.5,
                  bgcolor: '#fff',
                }}
              />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                TVSM School ERP
              </Typography>
            </Stack>

            <Box>
              <Typography component="h1" variant="h5" sx={{ fontWeight: 700 }}>
                Sign in
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                Use your school account to continue.
              </Typography>
            </Box>

            {notice && (
              <Alert severity="info" role="status">
                {notice}
              </Alert>
            )}
            <TextField
              label="Email"
              type="email"
              autoComplete="username"
              autoFocus
              fullWidth
              value={email}
              error={Boolean(errors.email)}
              helperText={errors.email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              fullWidth
              value={password}
              error={Boolean(errors.password)}
              helperText={errors.password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {formError && <Alert severity="error">{formError}</Alert>}
            <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              disabled={busy}
              aria-busy={busy || undefined}
              startIcon={busy ? <CircularProgress size={18} color="inherit" /> : null}
              sx={{ minHeight: 48, borderRadius: 2, boxShadow: 'none' }}
            >
              Sign in
            </Button>
          </Paper>

          <Typography variant="caption" color="text.secondary" align="center">
            Made by {SOFTWARE.madeBy} · © {SOFTWARE.year}
          </Typography>
        </Stack>
      </Box>
    </ThemeProvider>
  );
}

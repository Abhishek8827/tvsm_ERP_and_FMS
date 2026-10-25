import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { SOFTWARE } from '@erp/shared';
import { useAuth } from '../auth/AuthContext';

const loginTheme = createTheme({
  palette: {
    primary: { main: '#2457C5', dark: '#193F98', light: '#EAF0FF' },
    background: { default: '#EAF0FF', paper: '#FFFFFF' },
    text: { primary: '#172554', secondary: '#5B6785' },
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: 'Roboto, Arial, sans-serif',
    button: { fontWeight: 700, textTransform: 'none' },
  },
});

const fieldSx = {
  '& .MuiInputBase-input:focus-visible': {
    outline: 'none',
    boxShadow: 'none',
  },
  '& .MuiOutlinedInput-root': {
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
    transition: 'border-color 160ms ease, box-shadow 160ms ease',
    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#C7D2E2', borderWidth: 1 },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#8EA5C5' },
    '&.Mui-focused': { boxShadow: '0 0 0 3px rgba(36,87,197,0.10)' },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#2457C5', borderWidth: 1.5 },
    '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: '#D32F2F' },
  },
  '& .MuiInputLabel-root.Mui-focused': { color: '#2457C5' },
  '& .MuiFormHelperText-root': { minHeight: '1.15em', mx: 0.25 },
};

export function Login() {
  const { signIn, notice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    const next = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
      next.email = 'Enter a valid school email address.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch {
      setFormError('We could not sign you in. Check your details and try again.');
      setBusy(false);
    }
  }

  function updateEmail(value) {
    setEmail(value);
    if (errors.email) setErrors((current) => ({ ...current, email: undefined }));
    if (formError) setFormError('');
  }

  function updatePassword(value) {
    setPassword(value);
    if (errors.password) setErrors((current) => ({ ...current, password: undefined }));
    if (formError) setFormError('');
  }

  return (
    <ThemeProvider theme={loginTheme}>
      <Box
        component="main"
        sx={{
          minHeight: '100dvh',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: { xs: 2, sm: 4, lg: 7 },
          py: { xs: 4, md: 6 },
          overflow: 'hidden',
          backgroundColor: '#EDF3FF',
          backgroundImage:
            'radial-gradient(ellipse at 8% 18%, rgba(59,130,246,0.24), transparent 32%), radial-gradient(ellipse at 88% 78%, rgba(139,92,246,0.20), transparent 34%), radial-gradient(ellipse at 72% 8%, rgba(34,211,238,0.15), transparent 28%), linear-gradient(130deg, #E5EEFF 0%, #F4F1FF 52%, #E6F7FF 100%)',
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: 1240,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(220px, 0.8fr) minmax(400px, 1.2fr)' },
            gridTemplateAreas: {
              xs: '"school" "login" "emblem"',
              md: '"school school" "emblem login"',
            },
            alignItems: 'center',
            rowGap: { xs: 3, md: 4 },
            columnGap: { md: 7, lg: 10 },
          }}
        >
          <Box sx={{ gridArea: 'school', textAlign: 'center', px: { xs: 1, sm: 2 } }}>
            <Typography
              component="h1"
              sx={{
                color: '#19345F',
                fontWeight: 800,
                fontSize: { xs: '1.25rem', sm: '1.55rem', md: '2.5rem' },
                lineHeight: 1.25,
                letterSpacing: '-0.025em',
                textWrap: 'balance',
              }}
            >
              TH. VIRENDRA SINGH MEMORIAL HIGHER SECONDARY SCHOOL
            </Typography>
            <Typography
              sx={{ color: '#4E6387', fontSize: { xs: '0.95rem', sm: '1.5rem' }, mt: 1.5 }}
            >
              NEPANAGAR
            </Typography>
          </Box>

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gridArea: 'emblem',
              minWidth: 0,
            }}
          >
            <Box
              component="img"
              src="/logo.jpg"
              alt="Th. Virendra Singh Memorial School emblem"
              sx={{
                display: 'block',
                width: { xs: 112, sm: 144, md: 220, lg: 280 },
                height: { xs: 112, sm: 144, md: 220, lg: 280 },
                objectFit: 'contain',
                filter: 'drop-shadow(0 16px 28px rgba(35,65,120,0.12))',
                backgroundColor: 'transparent',
              }}
            />
          </Box>

          <Stack
            spacing={2}
            sx={{ width: '100%', maxWidth: 540, mx: 'auto', gridArea: 'login', minWidth: 0 }}
          >
            <Box sx={{ textAlign: 'center' }}>
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  px: 2,
                  py: 0.65,
                  borderRadius: 99,
                  color: '#244E9A',
                  backgroundColor: 'rgba(255,255,255,0.62)',
                  border: '1px solid rgba(255,255,255,0.9)',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                School ERP System
              </Box>
            </Box>

            <Paper
              component="form"
              onSubmit={onSubmit}
              noValidate
              elevation={0}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2.5,
                p: { xs: 2.75, sm: 4, md: 4.5 },
                border: '1px solid rgba(255,255,255,0.95)',
                borderRadius: { xs: 3, sm: 4 },
                backgroundColor: 'rgba(255,255,255,0.97)',
                boxShadow: '0 28px 80px rgba(45,67,130,0.16), 0 6px 20px rgba(45,67,130,0.06)',
                backdropFilter: 'blur(12px)',
              }}
            >
              <Box sx={{ textAlign: 'center', px: { xs: 0, sm: 1 }, mb: 0.5 }}>
                <Typography
                  component="h1"
                  sx={{
                    fontWeight: 800,
                    letterSpacing: '-0.04em',
                    fontSize: { xs: '1.8rem', sm: '2rem' },
                    color: '#172554',
                  }}
                >
                  Sign in
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.7 }}>
                  Use your school account to continue.
                </Typography>
              </Box>

              {notice && (
                <Alert severity="info" role="status" sx={{ borderRadius: 2 }}>
                  {notice}
                </Alert>
              )}

              <Stack spacing={1.75}>
                <TextField
                  label="Email"
                  type="email"
                  name="email"
                  autoComplete="username"
                  autoFocus
                  fullWidth
                  value={email}
                  error={Boolean(errors.email)}
                  helperText={errors.email || ' '}
                  onChange={(e) => updateEmail(e.target.value)}
                  slotProps={{
                    htmlInput: {
                      autoCapitalize: 'none',
                      autoCorrect: 'off',
                      spellCheck: false,
                    },
                  }}
                  sx={fieldSx}
                />
                <TextField
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  fullWidth
                  value={password}
                  error={Boolean(errors.password)}
                  helperText={errors.password || ' '}
                  onChange={(e) => updatePassword(e.target.value)}
                  sx={fieldSx}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            type="button"
                            edge="end"
                            onClick={() => setShowPassword((visible) => !visible)}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            aria-pressed={showPassword}
                            size="small"
                          >
                            <Typography
                              variant="caption"
                              sx={{
                                fontWeight: 700,
                                color: 'primary.main',
                                minWidth: 34,
                                textAlign: 'center',
                              }}
                            >
                              {showPassword ? 'Hide' : 'Show'}
                            </Typography>
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              </Stack>

              {formError && (
                <Alert severity="error" role="alert" sx={{ borderRadius: 2 }}>
                  {formError}
                </Alert>
              )}

              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                disabled={busy}
                aria-busy={busy || undefined}
                startIcon={busy ? <CircularProgress size={18} color="inherit" /> : null}
                sx={{
                  minHeight: 52,
                  mt: 0.25,
                  borderRadius: 2.5,
                  background: 'linear-gradient(100deg, #2457C5 0%, #3568D4 55%, #5B5BD6 100%)',
                  boxShadow: '0 10px 24px rgba(36,87,197,0.24)',
                  '&:hover': {
                    background: 'linear-gradient(100deg, #1D49AD 0%, #2B59C0 55%, #4F4FC2 100%)',
                    boxShadow: '0 12px 28px rgba(36,87,197,0.3)',
                  },
                  '&:focus-visible': {
                    outline: '3px solid rgba(36,87,197,0.35)',
                    outlineOffset: 3,
                  },
                }}
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </Paper>

            <Typography
              variant="caption"
              color="text.secondary"
              align="center"
              sx={{ px: 1, lineHeight: 1.6 }}
            >
              © {SOFTWARE.year} · {SOFTWARE.madeBy} · All rights reserved.
            </Typography>
          </Stack>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

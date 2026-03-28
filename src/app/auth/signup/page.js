'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthProvider';
import { useToast } from '@/components/ui/Toast';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

export default function SignupPage() {
  const [step, setStep] = useState(1); // 1: form, 2: OTP
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const { signUp, verifyOtp } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const validate = () => {
    const errs = {};
    if (!name.trim()) errs.name = 'Name is required';
    if (!email) errs.email = 'Email is required';
    if (!password) errs.password = 'Password is required';
    if (password.length < 6) errs.password = 'Min 6 characters';
    if (password !== confirmPassword) errs.confirmPassword = 'Passwords don\'t match';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    const { error } = await signUp(email, password, name);
    setLoading(false);

    if (error) {
      toast.error(error.message, 'Signup Failed');
    } else {
      toast.success('Check your email for the verification code!', 'Almost There!');
      setStep(2);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otp || otp.length < 6) {
      setErrors({ otp: 'Enter the 6-digit code' });
      return;
    }

    setLoading(true);
    const { error } = await verifyOtp(email, otp);
    setLoading(false);

    if (error) {
      toast.error(error.message, 'Verification Failed');
    } else {
      toast.success('Your account is ready!', 'Welcome to WanderForge! 🎉');
      router.push('/dashboard');
    }
  };

  return (
    <>
      <div className="auth-page">
        <div className="auth-page__bg">
          <div className="auth-page__orb auth-page__orb--1" />
          <div className="auth-page__orb auth-page__orb--2" />
        </div>

        <div className="auth-card glass animate-scale-in">
          {step === 1 ? (
            <>
              <div className="auth-card__header">
                <span className="auth-card__emoji">✨</span>
                <h1 className="auth-card__title">Start Your Journey</h1>
                <p className="auth-card__subtitle">Create your free WanderForge account</p>
              </div>

              <form onSubmit={handleSignup} className="auth-card__form">
                <Input
                  label="Display Name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Explorer Jane"
                  error={errors.name}
                  required
                  icon={
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  }
                />

                <Input
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="explorer@example.com"
                  error={errors.email}
                  required
                  icon={
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                  }
                />

                <Input
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  error={errors.password}
                  hint="Minimum 6 characters"
                  required
                  icon={
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  }
                />

                <Input
                  label="Confirm Password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  error={errors.confirmPassword}
                  required
                  icon={
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  }
                />

                <Button type="submit" variant="primary" fullWidth loading={loading} size="lg">
                  Create Account
                </Button>
              </form>
            </>
          ) : (
            <>
              <div className="auth-card__header">
                <span className="auth-card__emoji">📧</span>
                <h1 className="auth-card__title">Verify Email</h1>
                <p className="auth-card__subtitle">
                  We sent a 6-digit code to <strong>{email}</strong>
                </p>
              </div>

              <form onSubmit={handleVerifyOtp} className="auth-card__form">
                <Input
                  label="Verification Code"
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  error={errors.otp}
                  required
                  maxLength={6}
                  style={{ textAlign: 'center', letterSpacing: '0.5em', fontSize: 'var(--text-2xl)' }}
                />

                <Button type="submit" variant="primary" fullWidth loading={loading} size="lg">
                  Verify & Continue
                </Button>

                <Button variant="ghost" fullWidth onClick={() => setStep(1)}>
                  ← Back to signup
                </Button>
              </form>
            </>
          )}

          <div className="auth-card__footer">
            <p>
              Already have an account?{' '}
              <Link href="/auth/login" className="auth-card__link">Log in</Link>
            </p>
          </div>
        </div>
      </div>

      <style jsx>{`
        .auth-page {
          min-height: calc(100vh - var(--navbar-height));
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-8) var(--space-4);
          position: relative;
          overflow: hidden;
        }

        .auth-page__bg {
          position: absolute;
          inset: 0;
        }

        .auth-page__orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(100px);
        }

        .auth-page__orb--1 {
          width: 500px;
          height: 500px;
          background: var(--color-secondary);
          opacity: 0.08;
          top: -20%;
          left: -10%;
          animation: float 8s ease-in-out infinite;
        }

        .auth-page__orb--2 {
          width: 400px;
          height: 400px;
          background: var(--color-primary);
          opacity: 0.06;
          bottom: -20%;
          right: -10%;
          animation: float 10s ease-in-out infinite reverse;
        }

        .auth-card {
          width: 100%;
          max-width: 440px;
          border-radius: var(--radius-2xl);
          padding: var(--space-10);
          position: relative;
          z-index: 1;
        }

        .auth-card__header {
          text-align: center;
          margin-bottom: var(--space-8);
        }

        .auth-card__emoji {
          font-size: 48px;
          display: block;
          margin-bottom: var(--space-4);
        }

        .auth-card__title {
          font-size: var(--text-3xl);
          margin-bottom: var(--space-2);
        }

        .auth-card__subtitle {
          font-size: var(--text-sm);
          color: var(--color-text-tertiary);
        }

        .auth-card__subtitle strong {
          color: var(--color-primary);
        }

        .auth-card__form {
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        .auth-card__footer {
          text-align: center;
          margin-top: var(--space-6);
          padding-top: var(--space-6);
          border-top: 1px solid var(--color-border-light);
        }

        .auth-card__footer p {
          font-size: var(--text-sm);
          color: var(--color-text-tertiary);
        }

        .auth-card__link {
          color: var(--color-primary);
          font-weight: 600;
        }

        .auth-card__link:hover {
          text-decoration: underline;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-20px); }
        }
      `}</style>
    </>
  );
}

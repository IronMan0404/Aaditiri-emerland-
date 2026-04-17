import { Loader2 } from 'lucide-react';
import { ButtonHTMLAttributes } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const variants = {
  primary: 'bg-[#1B5E20] text-white hover:bg-[#2E7D32] active:bg-[#0A3D02]',
  secondary: 'bg-gray-100 text-gray-800 hover:bg-gray-200',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  outline: 'border border-[#1B5E20] text-[#1B5E20] hover:bg-green-50',
  ghost: 'text-gray-600 hover:bg-gray-100',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
};

export default function Button({ variant = 'primary', size = 'md', loading, children, disabled, className = '', ...props }: Props) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all ${variants[variant]} ${sizes[size]} disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

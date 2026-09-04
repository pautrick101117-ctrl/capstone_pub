import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const Register = () => {
  const { requestVerificationCode, register, loading } = useAuth()
  const [form, setForm] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    address: '',
    contactNumber: '',
    validId: null,
    verificationCode: '',
  })
  const [step, setStep] = useState(1)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const handleChange = (e) => {
    const { name, value, files } = e.target
    setForm((prev) => ({
      ...prev,
      [name]: files ? files[0] : value,
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setStatus('')
    try {
      if (step === 1) {
        await requestVerificationCode({
          email: form.email,
          firstName: form.firstName,
          lastName: form.lastName,
        })
        setStep(2)
        setStatus('A verification code has been sent to your email. Enter it below to complete registration.')
        return
      }

      const payload = new FormData()
      Object.entries(form).forEach(([key, value]) => {
        if (value) payload.append(key, value)
      })

      const data = await register(payload)
      setStatus(data.message)
      setStep(3)
    } catch (err) {
      setError(err.message)
    }
  }

  const inputClass =
    'w-full bg-white/30 border border-white/60 rounded px-3 py-1.5 text-white placeholder-white/60 text-sm focus:outline-none focus:ring-2 focus:ring-white/80 focus:bg-white/40 transition'

  const labelClass = 'block text-white text-xs font-bold mb-1'

  return (
    <div
      className="min-h-screen bg-cover bg-center flex items-center justify-center px-4 py-28"
      style={{ backgroundImage: "url('/landingPage-bg.png')" }}
    >
      {/* Card */}
      <div className="bg-green-600/80 backdrop-blur-sm rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-2xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-white font-extrabold text-xl tracking-wide uppercase">
            Create Resident Account
          </h1>
          <p className="text-white/90 text-sm mt-1 font-medium">
            Note: Your account will require admin approval before you can log in, and email verification is required.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {status ? <div className="mb-4 rounded-lg bg-white/90 px-4 py-3 text-sm font-medium text-green-800">{status}</div> : null}
          {error ? <div className="mb-4 rounded-lg bg-red-100 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {/* LEFT COLUMN */}
            <div className="flex flex-col gap-4">
              <div>
                <label className={labelClass}>First name</label>
                <input
                  type="text"
                  name="firstName"
                  value={form.firstName}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Middle name</label>
                <input
                  type="text"
                  name="middleName"
                  value={form.middleName}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Last name</label>
                <input
                  type="text"
                  name="lastName"
                  value={form.lastName}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Password</label>
                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Confirm Password</label>
                <input
                  type="password"
                  name="confirmPassword"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>

              {step !== 1 && (
                <div>
                  <label className={labelClass}>Verification Code</label>
                  <input
                    type="text"
                    name="verificationCode"
                    value={form.verificationCode}
                    onChange={handleChange}
                    className={inputClass}
                    placeholder="Enter 6-digit code"
                  />
                </div>
              )}
            </div>

            {/* RIGHT COLUMN */}
            <div className="flex flex-col gap-4">
              <div>
                <label className={labelClass}>Address</label>
                <input
                  type="text"
                  name="address"
                  value={form.address}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Contact number</label>
                <input
                  type="text"
                  name="contactNumber"
                  value={form.contactNumber}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Attach Valid ID</label>
                <input
                  type="file"
                  name="validId"
                  accept="image/*,.pdf"
                  onChange={handleChange}
                  className="w-full text-xs text-white/80 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-white/30 file:text-white hover:file:bg-white/40 cursor-pointer"
                />
                {form.validId && (
                  <p className="text-white/70 text-xs mt-1 truncate">{form.validId.name}</p>
                )}
              </div>

              {/* Buttons — pushed toward bottom-right */}
              <div className="flex flex-col gap-3 mt-auto pt-4">
                <button
                  type="submit"
                  disabled={loading || step === 3}
                  className="w-full bg-white text-green-800 font-bold py-2 rounded-full shadow hover:bg-green-50 transition text-sm tracking-wide"
                >
                  {step === 1 ? 'Send Verification Code' : step === 2 ? 'Complete Registration' : 'Registered'}
                </button>
                <Link
                  to="/login"
                  className="w-full bg-white text-green-800 font-bold py-2 rounded-full shadow hover:bg-green-50 transition text-sm tracking-wide text-center"
                >
                  BACK
                </Link>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

export default Register

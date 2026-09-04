const TermsOfUse = () => {
  return (
    <div className="max-w-5xl mx-auto px-6 py-12 text-gray-800 mt-28">

      <h1 className="text-3xl font-bold text-green-700 mb-2">
        Terms of Use
      </h1>

      <p className="text-gray-500 mb-6">
        Last updated: October 29, 2025
      </p>

      <section className="space-y-6 text-gray-700">

        <div>
          <h2 className="font-semibold text-lg">1. Acceptance of Terms</h2>
          <p>By using the E-Barangay Portal, you agree to follow all rules and policies.</p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">2. Eligibility</h2>
          <p>You must be a registered resident of Barangay IBA and at least 18 years old.</p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">3. Account Responsibilities</h2>
          <p>You are responsible for maintaining the confidentiality of your account.</p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">4. Acceptable Use</h2>
          <ul className="list-disc ml-6">
            <li>No illegal activities</li>
            <li>No false information</li>
            <li>No impersonation</li>
            <li>No system interference</li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold text-lg">5. Document Requests</h2>
          <p>
            All requests are subject to verification and must be claimed within 30 days.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">6. Limitation of Liability</h2>
          <p>
            The Barangay is not liable for system downtime or delays beyond control.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">7. Changes to Terms</h2>
          <p>
            Terms may be updated anytime without prior notice.
          </p>
        </div>

      </section>

      <div className="mt-10 text-center font-semibold text-green-700">
        Thank you for being a responsible digital citizen of Barangay IBA.
      </div>

    </div>
  )
}

export default TermsOfUse

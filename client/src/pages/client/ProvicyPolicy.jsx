const ProvicyPolicy = () => {
  return (
    <div className="max-w-5xl mx-auto px-6 py-12 text-gray-800 mt-28">

      <h1 className="text-3xl font-bold text-green-700 mb-2">
        Privacy Policy
      </h1>

      <p className="text-gray-500 mb-6">
        Data Privacy Act of 2012 (RA 10173) Compliance
      </p>

      <h2 className="text-xl font-semibold mb-2">Our Commitment</h2>
      <p className="mb-6 text-gray-700">
        We value your privacy and ensure your data is protected and used responsibly.
      </p>

      <div className="space-y-6">

        <div>
          <h3 className="font-semibold">1. Information We Collect</h3>
          <p>Personal data, government IDs, and portal usage activity.</p>
        </div>

        <div>
          <h3 className="font-semibold">2. How We Use Your Data</h3>
          <p>To process requests, verify identity, and improve services.</p>
        </div>

        <div>
          <h3 className="font-semibold">3. Data Security</h3>
          <p>We use encryption (SSL/TLS) and secure databases.</p>
        </div>

        <div>
          <h3 className="font-semibold">4. Data Sharing</h3>
          <p>Data is only shared with authorized barangay officials or legal authorities.</p>
        </div>

        <div>
          <h3 className="font-semibold">5. Your Rights</h3>
          <ul className="list-disc ml-6">
            <li>Access your data</li>
            <li>Correct information</li>
            <li>Request deletion (if applicable)</li>
          </ul>
        </div>

        <div>
          <h3 className="font-semibold">6. Contact Us</h3>
          <p>
            📧 e-barangayportal@gmail.com <br />
            📞 09-123-456-5432
          </p>
        </div>

      </div>

      <div className="mt-10 text-center text-green-700 font-semibold">
        Your trust is the foundation of our digital barangay.
      </div>

    </div>
  )
}

export default ProvicyPolicy

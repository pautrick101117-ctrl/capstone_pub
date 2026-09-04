const HelpCenter = () => {
  return (
    <div className="max-w-5xl mx-auto px-6 py-12 text-gray-800 mt-28">
      
      <h1 className="text-3xl font-bold text-green-700 mb-4">
        Help Center
      </h1>

      <p className="mb-6 text-gray-600">
        Welcome to the <b>E-Barangay Help Center</b> — your one-stop resource for support and guidance.
      </p>

      <h2 className="text-xl font-semibold mb-2">How Can We Assist You Today?</h2>
      <p className="mb-6 text-gray-600">
        Whether you're having trouble logging in, requesting a document, or navigating the portal,
        we're here to help. Our team is committed to ensuring a smooth experience for all residents.
      </p>

      <h2 className="text-xl font-semibold mb-3">Common Questions</h2>

      <div className="space-y-4 text-gray-700">
        <p><b>Q:</b> I forgot my password. What should I do?<br />
          <span className="text-gray-600">Use the “Forgot Password” link on the login page.</span>
        </p>

        <p><b>Q:</b> How long does document processing take?<br />
          <span className="text-gray-600">Usually 1–3 business days.</span>
        </p>

        <p><b>Q:</b> Can I track my request?<br />
          <span className="text-gray-600">Yes. Go to “My Requests” in your dashboard.</span>
        </p>
      </div>

      <div className="mt-8 p-4 bg-green-50 border border-green-200 rounded-lg">
        <p className="font-medium text-green-700">Need immediate help?</p>
        <p className="text-gray-700">
          📧 e-barangayportal@gmail.com <br />
          📞 09-123-456-6789 (Mon–Fri, 8 AM–5 PM)
        </p>
      </div>
    </div>
  )
}

export default HelpCenter

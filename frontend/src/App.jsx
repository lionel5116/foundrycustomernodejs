import FoundryChat from './FoundryChat'
import './App.css'

const cards = [
  {
    icon: '🔧',
    title: 'Schedule Service',
    description: 'Book a maintenance or repair appointment for your RAV4.',
    linkText: 'Schedule Now',
    href: '#',
  },
  {
    icon: '📍',
    title: 'Find a Dealer',
    description: 'Locate your nearest Toyota dealership.',
    linkText: 'Find a Dealer',
    href: '#',
  },
  {
    icon: '📖',
    title: "Owner's Manual",
    description: 'Browse RAV4 guides, specs, and features.',
    linkText: 'Learn More',
    href: '#',
  },
  {
    icon: '❓',
    title: 'Ask a Question',
    description: "Type your question in the chat and we'll help.",
  },
]

function App() {
  return (
    <div className="page-shell">
      <section className="info-panel">
        <h1>
          Welcome to
          <br />
          <span className="accent">RAV4 Support</span>
        </h1>
        <p className="subtitle">
          Your virtual assistant is here to help with vehicle features, maintenance, and
          ownership questions—anytime you need it.
        </p>

        <div className="card-list">
          {cards.map((card) => (
            <div className="card" key={card.title}>
              <div className="card-icon">{card.icon}</div>
              <div>
                <h2>{card.title}</h2>
                <p>{card.description}</p>
                {card.linkText && (
                  <a className="card-link" href={card.href}>
                    {card.linkText} &rarr;
                  </a>
                )}
              </div>
            </div>
          ))}

          <div className="card banner-card">
            <div className="card-icon banner-icon">🚗</div>
            <div>
              <h2>We're here for you 24/7.</h2>
              <p>Real answers about your RAV4. Real support. Real time.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="chat-panel">
        <FoundryChat agentTitle="RAV4 Support Agent" />
      </section>
    </div>
  )
}

export default App

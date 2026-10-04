import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { DemoBanner, Footer, LoadError, Spinner, TopBar } from '../components/ui';
import type { LegalDoc } from '../../shared/types';

export default function LegalPage() {
  const { slug = '' } = useParams();
  const [doc, setDoc] = useState<LegalDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    api<LegalDoc>(`/api/legal/${encodeURIComponent(slug)}`).then(setDoc, (e: Error) => setError(e.message));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [slug]);

  return (
    <>
      <DemoBanner />
      <main className="page stack-lg">
        <TopBar back={() => history.back()} />
        {error && <LoadError message={error} retry={load} />}
        {!doc && !error && <Spinner label="Cargando…" />}
        {doc && (
          <article className="stack">
            <h1>{doc.title}</h1>
            {!doc.approved && (
              <div className="notice warn" role="note">
                <strong>Borrador pendiente de aprobación del negocio.</strong> Este texto aún no es definitivo.
              </div>
            )}
            <p className="legal-body">{doc.body}</p>
          </article>
        )}
        <Footer />
      </main>
    </>
  );
}

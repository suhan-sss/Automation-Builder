import '../styles/globals.css';
import '../styles/automations.css';
import ToastProvider from '../components/Toast';

export const metadata = {
    title: 'Connect360 — Automation Builder',
    description: 'Visual workflow automation builder — generic event/condition/action engine across CRM, communication, ads, portals, AI, payments and property data.'
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>
                <ToastProvider>
                    {children}
                </ToastProvider>
            </body>
        </html>
    );
}
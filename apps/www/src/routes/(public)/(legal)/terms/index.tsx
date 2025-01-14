/* eslint-disable qwik/no-react-props */
import { Link } from "@builder.io/qwik-city";
import { Title, Text } from "@nestri/ui/react";
import { component$ } from "@builder.io/qwik";
import { buttonVariants } from "@nestri/ui/design";

export default component$(() => {
    return (
        <div class="w-screen relative" >
            <section class="px-4 relative" >
                <div class="mx-auto select-text max-w-xl overflow-x-hidden py-8 [&_h1]:text-3xl flex relative gap-4 w-full flex-col" >
                    <Title className="py-4 text-4xl" >
                        Nestri's  Terms of Service
                    </Title>

                    <Text className="py-2 dark:text-primary-50/80 text-primary-950/80" >
                        <strong>Last updated on:&nbsp;</strong>
                        1st July 2024
                    </Text>

                    <Text>
                        Welcome to Nestri and thank you for using our services. We are an innovative cloud gaming platform that offers both self-hosted and hosted versions for gamers to play online with friends and family.
                        <br />
                        <br />
                        By using Nestri, you agree to these Terms of Service ("Terms"). If you have any questions, feel free to contact us.
                    </Text>

                    <Title>Who We Are</Title>

                    <Text>Nestri is an open-source cloud gaming platform that lets you play games on your own terms — invite friends to join your gaming sessions, share your game library, and take even more control by hosting your own gaming server. Our hosted version is perfect for those who need GPU support.</Text>

                    <Title>Privacy and Security</Title>

                    <Text>We take your privacy and security very seriously. We adhere to stringent data protection laws and ensure that all data, is secured. We also collect and log IP addresses to avoid abuse and ensure the security of our services. For more details, please review our
                        <Link
                            href="/privacy"
                            class={buttonVariants.link()}>
                            Privacy Policy</Link>.
                    </Text>

                    <Title>Acceptance of Terms</Title>

                    <Text>By using Nestri, you agree to be bound by these Terms. If you're using Nestri on behalf of an organization, you agree to these Terms on behalf of that organization.</Text>

                    <Title>Your Games</Title>

                    <Text>You can run the games you own on Nestri. Please check the list of video games available on Nestri before purchasing a subscription. Sorry, but we will not provide a refund if a game you want to play is not available.
                        <br />
                        <br />
                        <Link
                            href="https://www.protondb.com/"
                            class={buttonVariants.link()}>
                            Check the list here</Link>.
                    </Text>

                    <Title>Game Ownership and Piracy</Title>

                    <Text>Nestri strictly prohibits the use of our platform for piracy. We are not liable if you are caught pirating using any of our products. Only run games that you legally own.</Text>

                    <Title>Family Sharing</Title>

                    <Text>Nestri allows family sharing by enabling your friends to access your Steam account from their Nestri account. Please take care of who you share your Nestri membership with. Note that no two people can play a game simultaneously as per Steam's requirements.</Text>

                    <Title>Cloud Saves</Title>

                    <Text>We use a custom cloud save provider to ensure your game progress is preserved for all the games you play. If you exit a game properly or close the stream for more than 15 minutes, we will automatically save your progress. However, this is limiting, and you may need to contact us to retrieve your game progress, if you plan on migrating to another service.</Text>

                    <Title>Your Responsibilities</Title>

                    <Text>Your use of our services must comply with these Terms and applicable Nestri policies, as well as applicable laws. You are solely responsible for the development, content, and use of the games you play on Nestri and assume all risks associated with them, including intellectual property or other legal claims.</Text>

                    <Title>Prohibited Activities</Title>

                    <Text>To maintain a great service, we require you to comply with certain limitations.
                        <br />
                        You may not:
                        <br />

                        <ul class="list-disc mx-8 list-item" >
                            <li>Violate any laws, regulations, ordinances, or directives.</li>
                            <li>Engage in any threatening, abusive, harassing, defamatory, or tortious conduct.</li>
                            <li>Harass or abuse Nestri personnel or representatives.</li>
                            <li>Use our services to support malware, phishing, spam, pirating, or similar activities.</li>
                            <li>Interfere with the proper functioning of our services.</li>
                            <li>Engage in any conduct that inhibits anyone else's use or enjoyment of our services.</li>
                            <li>Circumvent storage space limits or pricing.</li>
                            <li>Use the Nestri system inconsistently with its intended purpose.</li>
                            <li>Upload, transmit, or distribute any computer viruses, worms, or any software intended to damage or alter a computer system or data.</li>
                            <li>Send advertising, promotional materials, junk mail, spam, chain letters, pyramid schemes, or any other form of duplicative or unsolicited messages.</li>
                            <li>Harvest, collect, or assemble information or data regarding other users without their consent.</li>
                            <li>Attempt to gain unauthorized access to Nestri or other computer systems or networks connected to or used together with Nestri.</li>
                            <li>Use automated scripts to produce multiple accounts or to generate automated searches, requests, or queries.</li>
                        </ul>

                    </Text>

                    <Title>Our Rights</Title>

                    <Text>We reserve the right to change, eliminate, or restrict access to our services at any time. We may modify, suspend, or terminate a user account if you stop paying for our service or violate any of our Terms or policies. Nestri is not liable for any damages resulting from these actions.</Text>

                    <Title>Beta Services</Title>

                    <Text>We may release products and features still in testing and evaluation (“Beta Services”). Beta Services are confidential until official launch. By using Beta Services, you agree not to disclose any information about them without our permission.</Text>

                    <Title>Other Sites and Services</Title>

                    <Text>Nestri may contain links to websites, services, and advertisements that we neither own nor control. We do not endorse or assume responsibility for any third-party sites, information, materials, products, or services.</Text>

                    <Title>Children</Title>

                    <Text>Nestri is only for users 13 years old and older. If we become aware that a child under 13 has created an account, we will terminate that account.</Text>

                    <Title>Account Creation and Access</Title>

                    <Text>When you create a Nestri account, you will be required to set your account credentials, including an email address and a password. You are responsible for maintaining and safeguarding your account credentials. Nestri is under no obligation to provide you access to your account or your files if you are unable to provide the appropriate account credentials.</Text>

                    <Title>Service Cancellation and Account Deletion</Title>

                    <Text>You can cancel your Nestri service and delete your account at any time by signing in and deleting all your games and game progress stored on our system. If assistance is needed, please contact us. When you cancel your service, we will no longer bill you, except for past due amounts. Your canceled account information will remain accessible unless you delete your account.</Text>

                    <Title>Disclaimers</Title>

                    <Text>Nestri is provided "as is" without any warranties, express or implied. Except where otherwise prohibited by law, Nestri disclaims all warranties and conditions of merchantability, fitness for a particular purpose, and non-infringement.</Text>

                    <Title>Limitation of Liability</Title>

                    <Text>To the fullest extent allowed by law, Nestri shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses resulting from (A) your access to, use of, inability to access, or inability to use Nestri; (B) any third-party conduct or content on Nestri; or (C) any unauthorized access, use, or alteration of your content.</Text>

                    <Title>Arbitration and Opt-Out</Title>

                    <Text>We aim to resolve disputes fairly and quickly. If you have any issues with Nestri, please contact us, and we'll work with you in good faith to resolve the matter. If we can't solve the dispute informally, you and Nestri agree to resolve any claim through final and binding arbitration. You may opt out of the arbitration agreement by notifying us within 90 days of agreeing to these Terms.</Text>

                    <Title>Class Action and Trial Waiver</Title>

                    <Text>You and Nestri agree that each party may bring disputes against the other only in an individual capacity and not on behalf of any class of people. You and Nestri agree to waive the right to a trial by jury for all disputes.</Text>

                    <Title>Indemnification</Title>

                    <Text>You agree to indemnify, defend, and hold harmless Nestri from and against all liabilities, damages, and costs arising out of any claim by a third party against Nestri regarding (a) games and game progress stored with us by you, (b) your domains, or (c) your use of Nestri in violation of these terms.</Text>

                    <Title>Governing Law and Jurisdiction</Title>

                    <Text>These Terms will be governed by the laws applicable in your jurisdiction. For claims not subject to arbitration, we each agree to submit to the personal jurisdiction of the courts located in your jurisdiction.</Text>

                    <Title>Entire Agreement</Title>

                    <Text>These Terms and our Privacy Policy constitute the entire agreement between you and Nestri. If any provision of these Terms is found to be unenforceable, the remaining provisions will remain in full force and effect.</Text>

                    <Title>No Waiver</Title>

                    <Text>No waiver of any provision of these Terms shall be a further or continuing waiver of that term. Nestri's failure to assert any right or provision under these Terms does not constitute a waiver of that right or provision.</Text>

                    <Title>Modification</Title>

                    <Text>These Terms may be modified from time to time. The date of the most recent revisions will always be available on our website. If we make changes that we believe will substantially alter your rights, we will notify you. If you continue to use Nestri after modifications of the Terms, you agree to accept such modifications.</Text>

                    <Title>Contact</Title>

                    <Text>We welcome all questions, concerns, and feedback you might have about these terms. If you have suggestions for us, let us know at
                        <Link
                            href="mailto:support@nestri.io"
                            class={buttonVariants.link()}>
                            support@nestri.io
                        </Link>
                        .
                    </Text>

                    <Text align="center" className="pt-3">💖 Thank you for choosing Nestri for your cloud gaming needs! 💖</Text>
                </div>
            </section>
        </div>
    )
})
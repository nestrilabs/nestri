/* eslint-disable qwik/no-react-props */
import { Link } from "@builder.io/qwik-city";
import { Title, Text } from "@nestri/ui/react";
import { component$ } from "@builder.io/qwik";
import { buttonVariants } from "@nestri/ui/design";

export default component$(() => {

    return (
        <div class="w-screen relative" >
            <section class="px-4 relative" >
                <div class="mx-auto select-text max-w-xl py-8 [&_h1]:text-3xl flex relative gap-4 w-full flex-col" >
                    <Title className="py-4 text-4xl" >
                        Nestri's Privacy Policy
                    </Title>

                    <Text className="py-2 dark:text-primary-50/80 text-primary-950/80" >
                        <strong>Last updated on:&nbsp;</strong>
                        1st July 2024
                    </Text>

                    <Text>
                        Welcome to Nestri. Thank you for using our service. We value you and we know privacy is important to you. It's important to us, too.
                        <br />
                        <br />
                        This Privacy Policy describes how we collect, use, disclose, and protect the personal data we collect through our website, products, services, and applications that link to this Privacy Policy (collectively, the "Services").

                    </Text>

                    <Title>Information We Collect</Title>

                    <Text>We may collect personal information directly from you or automatically when you use our Services. The types of personal information we may collect include:
                        <br />

                        <ul class="list-disc mx-8 list-item" >
                            <li>
                                <strong>Contact Information:</strong>
                                &nbsp;such as name and email address.
                            </li>
                            <li>
                                <strong>Account Credentials:</strong>
                                &nbsp;such as usernames and passwords.
                            </li>
                            <li>
                                <strong>Limited Payment Processing Information:</strong>
                                &nbsp;such as whether the transaction happened, its status, type and amount, as well as what payment scheme or operator you’ve used.
                                We <strong>DO NOT</strong>&nbsp;collect information about your bank card number, bank account number, cardholder’s name.
                            </li>
                            <li>
                                <strong>Usage Information:</strong>
                                &nbsp;such as your IP address, browser type, operating system, and device information.
                            </li>
                            <li>
                                <strong>Cookies and Similar Technologies:</strong>
                                &nbsp;to collect information about your interactions with our Services.
                            </li>
                            <li>
                                <strong>Additional Information: </strong>
                                &nbsp;such as age, gender, games played, activity across our products, games "installed," crash reports, technical data about your device (including internet speed, IP, location, mobile type, hardware details), and games on Steam (from Steam).
                            </li>
                        </ul>

                    </Text>

                    <Title>How We Use Your Information</Title>

                    <Text>We may use the personal information we collect for the following purposes:
                        <br />

                        <ul class="list-disc mx-8 list-item" >
                            <li>
                                <strong>To Provide and Maintain Our Services:</strong>
                                &nbsp;ensuring they function correctly and securely.
                            </li>
                            <li>
                                <strong>To Process and Fulfill Your Requests:</strong>
                                &nbsp;such as subscription management and customer support.
                            </li>
                            <li>
                                <strong>To Communicate with You:</strong>
                                &nbsp;including responding to your inquiries and providing customer support.
                            </li>
                            <li>
                                <strong>To Personalize Your Experience and Improve Our Services:</strong>
                                &nbsp; based on your usage and preferences.
                            </li>
                            <li>
                                <strong>To Send You Marketing Communications and Promotional Offers:</strong>
                                &nbsp;if you have opted in to receive them.
                            </li>
                            <li>
                                <strong>To Detect, Prevent, and Investigate Piracy and Other Illegal Activities:</strong>
                                &nbsp;ensuring the integrity of our platform.
                            </li>
                            <li>
                                <strong>To Comply with Legal Obligations and Enforce Our Terms and Policies:</strong>
                                &nbsp;including our Terms of Service.
                            </li>
                        </ul>

                    </Text>

                    <Title>Data Sharing and Disclosure</Title>

                    <Text>We may share your personal information with third parties in the following circumstances:
                        <br />

                        <ul class="list-disc mx-8 list-item" >
                            <li>
                                <strong>With Our Affiliates and Subsidiaries:</strong>
                                &nbsp;for the purposes described in this Privacy Policy.
                            </li>
                            <li>
                                <strong>With Third Parties for Marketing Purposes:</strong>
                                &nbsp; if you have consented to such sharing.
                            </li>
                            <li>
                                <strong>In Connection with a Merger, Acquisition, or Sale:</strong>
                                &nbsp;of all or a portion of our assets.
                            </li>
                            <li>
                                <strong>With Service Providers:</strong>
                                &nbsp;who assist us in operating our business and providing our Services.
                            </li>
                        </ul>
                    </Text>

                    <Title>Your Rights and Choices</Title>

                    <Text>
                        You have certain rights regarding your personal information, including the right to access, correct, or delete your information. You may also have the right to object to certain processing activities and to withdraw your consent where applicable.
                    </Text>

                    <Title>Data Transfers</Title>

                    <Text>If we transfer your personal information outside of the European Economic Area (EEA), we will ensure that adequate safeguards are in place to protect your information, such as standard contractual clauses approved by the European Commission.</Text>

                    <Title>Security Measures</Title>

                    <Text>We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, disclosure, alteration, or destruction.</Text>

                    <Title>Children's Privacy</Title>

                    <Text>Our Services are not directed to children under the age of 13, and we do not knowingly collect personal information from children under this age. If you are a parent or guardian and believe that your child has provided us with personal information, please contact us, and we will take steps to delete such information. Children merit specific protection with regard to their personal data. If we decide to knowingly collect personal data from a child under 13, we will ask for consent from the holder of parental responsibility over the child.</Text>

                    <Title>Changes to This Privacy Policy</Title>

                    <Text>We may update this Privacy Policy from time to time to reflect changes in our practices or applicable law. We will notify you of any material changes by posting the updated Privacy Policy on our website.</Text>

                    <Title>Contact Us</Title>

                    <Text>
                        If you have any questions or concerns about our Privacy Policy or our data practices, you may contact us at
                        <Link
                            href="mailto:support@nestri.io"
                            class={buttonVariants.link()}>
                            support@nestri.io
                        </Link>.
                    </Text>

                    <Title>Legal Basis for Processing (for Users in the EEA)</Title>

                    <Text>If you are located in the European Economic Area (EEA), our legal basis for collecting and using the personal information described in this Privacy Policy will depend on the personal information concerned and the specific context in which we collect it. We will only process your personal information if we have a valid legal basis for doing so under applicable data protection law.</Text>

                    <Text align="center" className="pt-3">
                        💖 Thank you for trusting Nestri with your data and gaming experience.💖
                        <br />
                        <br />
                        We are committed to safeguarding your personal information and ensuring your privacy. </Text>
                </div>
            </section>
        </div>
    )
})